var fs = require('fs')
var tape = require('tape')
var http = require('http')
var levelmem = require('level-mem')

var authenticClient = require('../')
var authenticServer = require('authentic-server')
var authenticService = require('authentic-service')

var client
var lastEmail

var service
var serviceUrl

var server
var serverUrl

tape('init', function (t) {
  server = createServer()
  server.listen(0, function (err) {
    if (err) return console.error(err)

    serverUrl = 'http://localhost:' + this.address().port

    client = authenticClient({server: serverUrl})

    service = createService(serverUrl)
    service.listen(0, function (err) {
      if (err) return console.error(err)
      serviceUrl = 'http://localhost:' + this.address().port
      t.end()
    })
  })
})

tape('request microservice without token', function (t) {
  client.get(serviceUrl, function (err, data) {
    t.equal(err.message, 'forbidden', 'should get forbidden error')
    t.end()
  })
})

tape('signup, confirm, login', function (t) {
  var signOpts = {
    email: 'chet@scalehaus.io',
    password: 'notswordfish',
    confirmUrl: 'http://admin.scalehaus.io/confirm'
  }

  client.signup(signOpts, function (err, resp) {
    t.ifError(err, 'should not error')
    t.equal(resp.success, true, 'should succeed')
    var confirmToken = lastEmail.confirmToken
    t.equal(confirmToken.length, 60, 'should get confirmToken')

    var confirmOpts = {
      email: signOpts.email,
      confirmToken: confirmToken
    }

    client.confirm(confirmOpts, function (err, resp) {
      t.ifError(err, 'should not error')
      t.equal(resp.success, true, 'should succeed')
      t.ok(resp.data.authToken.length > 800, 'should get authToken')

      t.equal(resp.data.authToken, client.authToken, 'should store token')

      t.end()
    })
  })
})

tape('microservice GET with token', function (t) {
  client.get(serviceUrl, function (err, data) {
    t.ifError(err, 'should not error')
    t.equal(data.email, 'chet@scalehaus.io', 'should have auth email')
    t.end()
  })
})

tape('microservice POST with token', function (t) {
  var postData = {dummy: 'data'}
  client.post(serviceUrl, postData, function (err, data) {
    t.ifError(err, 'should not error')
    t.equal(data.authData.email, 'chet@scalehaus.io', 'should have auth email')
    t.deepEqual(data.postData, postData, 'should get postData')
    t.end()
  })
})

tape('cleanup', function (t) {
  server.close()
  service.close()
  t.end()
})

function createServer () {
  return http.createServer(authenticServer({
    db: levelmem('mem', {valueEncoding: 'json'}),
    publicKey: fs.readFileSync(__dirname + '/rsa-public.pem', 'utf-8'),
    privateKey: fs.readFileSync(__dirname + '/rsa-private.pem', 'utf-8'),
    sendEmail: function (emailOpts, cb) {
      lastEmail = emailOpts
      setImmediate(cb)
    }
  }))
}

function createService (serverUrl) {
  var decrypt = authenticService({server: serverUrl})
  return http.createServer(function (req, res) {
    decrypt(req, res, function (err, authData) {
      if (err) return console.error(err)
      if (!authData || !authData.email) {
        res.writeHead(403, {'Content-Type': 'application/json'})
        return res.end(JSON.stringify({error: 'forbidden'}))
      }

      res.writeHead(200, {'Content-Type': 'application/json'})

      if (req.method === 'GET') return res.end(JSON.stringify(authData))

      var buf = ''
      req.on('data', function (chunk) { buf += chunk })
      req.on('end', function () {
        res.end(JSON.stringify({
          authData: authData,
          postData: JSON.parse(buf)
        }))
      })
    })
  })
}
