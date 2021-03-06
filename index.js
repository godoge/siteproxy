var express = require('express')
const https = require('https')
const zlib = require("zlib")
const fs = require("fs")
const cookiejar = require('cookiejar')
const {CookieAccessInfo, CookieJar, Cookie} = cookiejar
const path = require('path')
var Proxy = require('./Proxy')

let config = {
    httpprefix: 'https', port: 443,
    serverName: 'siteproxy.now.sh',
}
if (process.env.localFlag === 'true') {
    config.httpprefix = 'http'
    config.port = '8011'
    process.env.PORT = config.port
    config.serverName = '127.0.0.1'
}

let {httpprefix, serverName, port, accessCode} = config

const locationReplaceMap302 = { // when we have redirect(302) code received, we need to modify the location header
    'https://': {
        'https://([-a-z0-9A-Z.]+)': `${httpprefix}://${serverName}:${port}/https/$1`,
    },
    'http://': {
        'http://([-a-z0-9A-Z.]+)': `${httpprefix}://${serverName}:${port}/http/$1`,
    },
}
const regReplaceMap = {
    '"//([-a-z0-9A-Z.]+)': `"//${serverName}:${port}/https/$1`, // default use https
    '\'//([-a-z0-9A-Z.]+)': `'//${serverName}:${port}/https/$1`,// default use https
    'url[(]//([-a-z0-9A-Z.]+)': `url(//${serverName}:${port}/https/$1`,// default use https
    'https:(././)([-a-z0-9A-Z.]+)': `${httpprefix}:$1${serverName}:${port}/https/$2`,
    'http:(././)([-a-z0-9A-Z.]+)': `${httpprefix}:$1${serverName}:${port}/http/$2`,
    'https://([-a-z0-9A-Z.]+)': `${httpprefix}://${serverName}:${port}/https/$1`,
    'http://([-a-z0-9A-Z.]+)': `${httpprefix}://${serverName}:${port}/http/$1`,
    'https%3a%2f%2f([-a-z0-9A-Z]+?)': `${httpprefix}%3a%2f%2f${serverName}%3a${port}%2fhttps%2f$1`,
    'http%3a%2f%2f([-a-z0-9A-Z]+?)': `${httpprefix}%3a%2f%2f${serverName}%3a${port}%2fhttp%2f$1`,
}
const siteSpecificReplace = {
    'www.google.com': {
        '(s=.)/images/': `$1/https/www.google.com/images/`,
        '(/xjs/_)':`/https/www.google.com$1`,
        'srcset="/images/branding/googlelogo': `srcset="/https/www.google.com/images/branding/googlelogo`,
   //      '/search\?"': `/https/www.google.com/search?"`,
        '"(/gen_204\?)': `"/https/www.google.com$1`,
        '"(www.gstatic.com)"': `"${httpprefix}://${serverName}:${port}/https/$1"`,
        'J+"://"': `J+"://${serverName}:${port}/https/"`,
    },
    'www.youtube.com': {
        '/manifest.json': `/https/www.youtube.com/manifest.json`,
        '("url":")/([-a-z0-9]+?)': `$1/https/www.youtube.com/$2`,
        // ';this...logo.hidden=!0;': ';',
        // '&&this...': '&&this.$&&this.$.',
    },
    'wikipedia.org': {
    },
    'wikimedia.org': {
    },
    'twitter.com': {
        '"/settings"': '"/https/twitter.com/settings"',
        '"/signup"': '"/https/twitter.com/signup"',
        '"/login/error"': '"/https/twitter.com/login/error"',
        '"/i/flow/signup"': '"/https/twitter.com/i/flow/signup"',
        '"/i/sms_login"': '"/https/twitter.com/i/sms_login"',
        '"/login/check"': '"/https/twitter.com/login/check"',
        '"/login"': '"/https/twitter.com/login"',
    },
    'web.telegram.org': {
        '"pluto"': `"${serverName}:${port}/https/pluto"`,
        '"venus"': `"${serverName}:${port}/https/venus"`,
        '"aurora"': `"${serverName}:${port}/https/aurora"`,
        '"vesta"': `"${serverName}:${port}/https/vesta"`,
        '"flora"': `"${serverName}:${port}/https/flora"`,
    },
    'zh-cn.facebook.com': {
        '"/ajax/bz"': `"/https/zh-cn.facebook.com/ajax/bz"`,
    },
    'static.xx.fbcdn.net': {
        '"/ajax/bz"': `"/https/zh-cn.facebook.com/ajax/bz"`,
        '"/intern/common/': '"/https/static.xx.fbcdn.net/intern/common/',
    },
}
const pathReplace = ({host, httpType, body}) => {
    let myRe = new RegExp('href="[.]?/([-a-z0-9]+?)', 'g')
    body = body.replace(myRe, `href="/${httpType}/${host}/$1`)

    myRe = new RegExp(' src=(["\'])/([-a-z0-9]+?)', 'g')
    body = body.replace(myRe, ` src=$1/${httpType}/${host}/$2`)

    myRe = new RegExp(' src=(["\'])//([-a-z0-9]+?)', 'g')
	body = body.replace(myRe, ` src=$1//${serverName}:${port}/${httpType}/${host}/$2`)

    myRe = new RegExp('([: ]url[(]["]?)/([-a-z0-9]+?)', 'g')
    body = body.replace(myRe, `$1/${httpType}/${host}/$2`)

    myRe = new RegExp(' action="/([-a-z0-9A-Z]+?)', 'g')
    body = body.replace(myRe, ` action="/${httpType}/${host}/$1`)

    return body
}

let app = express()
let cookieDomainRewrite = serverName

let proxy = Proxy({httpprefix, serverName, port, cookieDomainRewrite, locationReplaceMap302, regReplaceMap, siteSpecificReplace, pathReplace})

app.use((req, res, next) => {
  console.log(`req.url:${req.url}`)

  if (req.url === `/bg-gr-v.png`) {
    body = fs.readFileSync(path.join(__dirname, './bg-gr-v.png'))
    res.status(200).send(body)
    return
  } else
  if (req.url === `/style.css`) {
    body = fs.readFileSync(path.join(__dirname, './style.css'), encoding='utf-8')
    res.status(200).send(body)
    return
  } else
  if (req.url === '/' || req.url === '/index.html') {
    body = fs.readFileSync(path.join(__dirname, './index.html'), encoding='utf-8')
    res.status(200).send(body)
    return
  }
  next()
})

app.use(proxy)

let reallistenPort = process.env.PORT || 8011
app.listen(reallistenPort)

console.log(`listening on port:${reallistenPort}`)
