var http = require('http');
var cache = {};

function Cookies(request, response, keys) {
  this.request = request
  this.response = response
  this.keys = keys
  this.isFakeRequest = request && request._isFakedForCookies;
}

Cookies.fromHeaderString = function(cookieHeader, keygrip) {
	var cookies = new Cookies({
		headers: {
			cookie: cookieHeader
		},
		_isFakedForCookies: true
	}, null, keygrip);
	return cookies;
}

Cookies.fromHttp = function(req, res, keygrip) {
	return new Cookies(req, res, keygrip);
}

Cookies.prototype = {
  get: function(name, opts) {
    var sigName = name + ".sig"
      , header, match, value, remote, data, index
      , signed = opts && opts.signed !== undefined ? opts.signed : !!this.keys

    header = this.request.headers["cookie"]
    if (!header) return

    match = header.match(getPattern(name))
    if (!match) return

    value = match[1]
    if (!opts || !signed) return value

    remote = this.get(sigName)
    if (!remote) return

    data = name + "=" + value
    index = this.keys.index(data, remote)

    if (index < 0) {
      this.set(sigName, null, {path: "/", signed: false })
    } else {
      index && this.set(sigName, this.keys.sign(data), { signed: false })
      return value
    }
  },

  set: function(name, value, opts) {
  	if(this.isFakeRequest) return this;
  	
    var res = this.response
      , req = this.request
      , headers = res.getHeader("Set-Cookie") || []
      , secure = req.connection.encrypted
      , cookie = new Cookie(name, value, opts)
      , signed = opts && opts.signed !== undefined ? opts.signed : !!this.keys

    if (typeof headers == "string") headers = [headers]

    if (!secure && opts && opts.secure) throw new Error("Cannot send secure cookie over unencrypted socket")

    cookie.secure = secure
    if (opts && "secure" in opts) cookie.secure = opts.secure
    if (opts && "secureProxy" in opts) cookie.secure = opts.secureProxy
    headers = pushCookie(headers, cookie)

    if (opts && signed) {
      cookie.value = this.keys.sign(cookie.toString())
      cookie.name += ".sig"
      headers = pushCookie(headers, cookie)
    }

    var setHeader = res.set ? http.OutgoingMessage.prototype.setHeader : res.setHeader
    setHeader.call(res, 'Set-Cookie', headers)
    return this
  }
}

function Cookie(name, value, attrs) {
  value || (this.expires = new Date(0))

  this.name = name
  this.value = value || ""

  for (var name in attrs) this[name] = attrs[name]
}

Cookie.prototype = {
  path: "/",
  expires: undefined,
  domain: undefined,
  httpOnly: true,
  secure: false,
  overwrite: false,

  toString: function() {
    return this.name + "=" + this.value
  },

  toHeader: function() {
    var header = this.toString()

    if (this.path     ) header += "; path=" + this.path
    if (this.expires  ) header += "; expires=" + this.expires.toUTCString()
    if (this.domain   ) header += "; domain=" + this.domain
    if (this.secure   ) header += "; secure"
    if (this.httpOnly ) header += "; httponly"

    return header
  }
}

function getPattern(name) {
  if (cache[name]) return cache[name]

  return cache[name] = new RegExp(
    "(?:^|;) *" +
    name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") +
    "=([^;]*)"
  )
}

function pushCookie(cookies, cookie) {
  if (cookie.overwrite) {
    cookies = cookies.filter(function(c) { return c.indexOf(cookie.name+'=') !== 0 })
  }
  cookies.push(cookie.toHeader())
  return cookies
}

Cookies.connect = Cookies.express = function(keys) {
  return function(req, res, next) {
    req.cookies = res.cookies = new Cookies(req, res, keys)
    next()
  }
}

Cookies.Cookie = Cookie

module.exports = Cookies
