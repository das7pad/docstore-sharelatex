/* eslint-disable
    camelcase,
    handle-callback-err,
    no-unused-vars,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
let DocstoreClient
const request = require('request').defaults({ jar: false })
const settings = require('settings-sharelatex')

const AWS = require('aws-sdk')
const s3 = new AWS.S3({
  accessKeyId: settings.docstore.s3.key,
  secretAccessKey: settings.docstore.s3.secret,
  endpoint: settings.docstore.s3.endpoint,
  s3ForcePathStyle: settings.docstore.s3.forcePathStyle,
  signatureVersion: 'v4'
})

module.exports = DocstoreClient = {
  createDoc(project_id, doc_id, lines, version, ranges, callback) {
    if (callback == null) {
      callback = function (error) {}
    }
    return DocstoreClient.updateDoc(
      project_id,
      doc_id,
      lines,
      version,
      ranges,
      callback
    )
  },

  getDoc(project_id, doc_id, qs, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    return request.get(
      {
        url: `http://localhost:${settings.internal.docstore.port}/project/${project_id}/doc/${doc_id}`,
        json: true,
        qs
      },
      callback
    )
  },

  getAllDocs(project_id, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    return request.get(
      {
        url: `http://localhost:${settings.internal.docstore.port}/project/${project_id}/doc`,
        json: true
      },
      callback
    )
  },

  getAllRanges(project_id, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    return request.get(
      {
        url: `http://localhost:${settings.internal.docstore.port}/project/${project_id}/ranges`,
        json: true
      },
      callback
    )
  },

  updateDoc(project_id, doc_id, lines, version, ranges, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    return request.post(
      {
        url: `http://localhost:${settings.internal.docstore.port}/project/${project_id}/doc/${doc_id}`,
        json: {
          lines,
          version,
          ranges
        }
      },
      callback
    )
  },

  deleteDoc(project_id, doc_id, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    return request.del(
      {
        url: `http://localhost:${settings.internal.docstore.port}/project/${project_id}/doc/${doc_id}`
      },
      callback
    )
  },

  archiveAllDoc(project_id, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    return request.post(
      {
        url: `http://localhost:${settings.internal.docstore.port}/project/${project_id}/archive`
      },
      callback
    )
  },

  destroyAllDoc(project_id, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    return request.post(
      {
        url: `http://localhost:${settings.internal.docstore.port}/project/${project_id}/destroy`
      },
      callback
    )
  },

  getS3Doc(project_id, doc_id, callback) {
    if (callback == null) {
      callback = function (error, res, body) {}
    }
    const options = {
      Bucket: settings.docstore.s3.bucket,
      Key: project_id + '/' + doc_id
    }
    s3.getObject(options, (err, response) => {
      if (err) {
        return callback(err)
      }
      return callback(err, response, JSON.parse(response.Body.toString()))
    })
  },

  putS3DocOld: function (key, lines, callback) {
    if (callback == null) {
      callback = function (error, res) {}
    }
    const options = {
      Bucket: settings.docstore.s3.bucket,
      Key: key,
      Body: JSON.stringify(lines)
    }
    s3.putObject(options, callback)
  }
}
