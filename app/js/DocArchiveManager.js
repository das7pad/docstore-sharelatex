/* eslint-disable
    camelcase,
    handle-callback-err,
    no-useless-escape,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
let DocArchive
const MongoManager = require('./MongoManager')
const Errors = require('./Errors')
const logger = require('logger-sharelatex')
const _ = require('underscore')
const async = require('async')
const settings = require('settings-sharelatex')
const crypto = require('crypto')
const RangeManager = require('./RangeManager')

const AWS = require('aws-sdk')
const s3 = new AWS.S3({
  accessKeyId: settings.docstore.s3.key,
  secretAccessKey: settings.docstore.s3.secret,
  endpoint: settings.docstore.s3.endpoint,
  s3ForcePathStyle: settings.docstore.s3.forcePathStyle,
  signatureVersion: 'v4'
})

function calculateMD5(blob) {
  return crypto.createHash('md5').update(blob, 'utf8').digest('hex')
}

function getMD5fromResponse(response) {
  const md5fromETag = (response.ETag || '').replace(/[ "]/g, '')
  if (md5fromETag.match(/^[a-f0-9]{32}$/)) {
    return md5fromETag
  }
  return null
}

function getMD5fromResponseOrCalculate(response, key, callback) {
  if (callback == null) {
    callback = function (error, md5) {}
  }
  const md5fromETag = getMD5fromResponse(response)
  if (md5fromETag) {
    return callback(null, md5fromETag)
  }
  const options = {
    Bucket: settings.docstore.s3.bucket,
    Key: key
  }
  s3.headObject(options, function (error, response) {
    if (error) {
      return callback(error)
    }
    callback(null, getMD5fromResponse(response))
  })
}

module.exports = DocArchive = {
  archiveAllDocs(project_id, callback) {
    if (callback == null) {
      callback = function (err, docs) {}
    }
    return MongoManager.getProjectsDocs(
      project_id,
      { include_deleted: true },
      { lines: true, ranges: true, rev: true, inS3: true },
      function (err, docs) {
        if (err != null) {
          return callback(err)
        } else if (docs == null) {
          return callback(
            new Errors.NotFoundError(`No docs for project ${project_id}`)
          )
        }
        docs = _.filter(docs, (doc) => doc.inS3 !== true)
        const jobs = _.map(docs, (doc) => (cb) =>
          DocArchive.archiveDoc(project_id, doc, cb)
        )
        return async.parallelLimit(jobs, 5, callback)
      }
    )
  },

  archiveDoc(project_id, doc, callback) {
    logger.log({ project_id, doc_id: doc._id }, 'sending doc to s3')
    DocArchive._mongoDocToS3Doc(doc, function (error, json_doc) {
      if (error) {
        return callback(error)
      }
      const key = project_id + '/' + doc._id
      const md5lines = calculateMD5(json_doc)
      const options = {
        Bucket: settings.docstore.s3.bucket,
        Key: key,
        Body: json_doc,
        ContentMD5: Buffer.from(md5lines, 'hex').toString('base64')
      }
      s3.putObject(options, function (err, response) {
        if (err) {
          logger.err(
            {
              err,
              project_id,
              doc_id: doc._id
            },
            'something went wrong archiving doc in aws'
          )
          return callback(new Error('Error in S3 request'))
        }
        getMD5fromResponseOrCalculate(response, key, (err, md5response) => {
          if (err != null) {
            logger.err(
              {
                err: err,
                project_id: project_id,
                doc_id: doc._id
              },
              'failed to fetch doc from s3 for content validation'
            )
            return callback(new Error('Error in S3 response for validation'))
          }
          if (md5lines !== md5response) {
            logger.err(
              {
                responseMD5: md5response,
                linesMD5: md5lines,
                project_id,
                doc_id: doc != null ? doc._id : undefined
              },
              'err in response md5 from s3'
            )
            return callback(new Error('Error in S3 md5 response'))
          }
          MongoManager.markDocAsArchived(doc._id, doc.rev, function (err) {
            if (err != null) {
              return callback(err)
            }
            return callback()
          })
        })
      })
    })
  },

  unArchiveAllDocs(project_id, callback) {
    if (callback == null) {
      callback = function (err) {}
    }
    return MongoManager.getArchivedProjectDocs(project_id, function (
      err,
      docs
    ) {
      if (err != null) {
        logger.err({ err, project_id }, 'error unarchiving all docs')
        return callback(err)
      } else if (docs == null) {
        return callback(
          new Errors.NotFoundError(`No docs for project ${project_id}`)
        )
      }
      const jobs = _.map(
        docs,
        (doc) =>
          function (cb) {
            if (doc.inS3 == null) {
              return cb()
            } else {
              return DocArchive.unarchiveDoc(project_id, doc._id, cb)
            }
          }
      )
      return async.parallelLimit(jobs, 5, callback)
    })
  },

  unarchiveDoc(project_id, doc_id, callback) {
    logger.log({ project_id, doc_id }, 'getting doc from s3')
    const options = {
      Bucket: settings.docstore.s3.bucket,
      Key: project_id + '/' + doc_id
    }
    s3.getObject(options, function (err, response) {
      if (err) {
        logger.err(
          { err, project_id, doc_id },
          'something went wrong unarchiving doc from aws'
        )
        return callback(new Errors.NotFoundError('Error in S3 request'))
      }
      DocArchive._s3DocToMongoDoc(response.Body, function (error, mongo_doc) {
        if (error != null) {
          return callback(error)
        }
        return MongoManager.upsertIntoDocCollection(
          project_id,
          doc_id.toString(),
          mongo_doc,
          function (err) {
            if (err != null) {
              return callback(err)
            }
            logger.log({ project_id, doc_id }, 'deleting doc from s3')
            return DocArchive._deleteDocFromS3(project_id, doc_id, callback)
          }
        )
      })
    })
  },

  destroyAllDocs(project_id, callback) {
    if (callback == null) {
      callback = function (err) {}
    }
    return MongoManager.getProjectsDocs(
      project_id,
      { include_deleted: true },
      { _id: 1 },
      function (err, docs) {
        if (err != null) {
          logger.err({ err, project_id }, "error getting project's docs")
          return callback(err)
        } else if (docs == null) {
          return callback()
        }
        const jobs = _.map(docs, (doc) => (cb) =>
          DocArchive.destroyDoc(project_id, doc._id, cb)
        )
        return async.parallelLimit(jobs, 5, callback)
      }
    )
  },

  destroyDoc(project_id, doc_id, callback) {
    logger.log({ project_id, doc_id }, 'removing doc from mongo and s3')
    return MongoManager.findDoc(project_id, doc_id, { inS3: 1 }, function (
      error,
      doc
    ) {
      if (error != null) {
        return callback(error)
      }
      if (doc == null) {
        return callback(new Errors.NotFoundError('Doc not found in Mongo'))
      }
      if (doc.inS3 === true) {
        return DocArchive._deleteDocFromS3(project_id, doc_id, function (err) {
          if (err != null) {
            return err
          }
          return MongoManager.destroyDoc(doc_id, callback)
        })
      } else {
        return MongoManager.destroyDoc(doc_id, callback)
      }
    })
  },

  _deleteDocFromS3(project_id, doc_id, callback) {
    const options = {
      Bucket: settings.docstore.s3.bucket,
      Key: project_id + '/' + doc_id
    }
    s3.deleteObject(options, function (err) {
      if (err != null) {
        logger.err(
          { err, project_id, doc_id },
          'something went wrong deleting doc from aws'
        )
        return callback(new Error('Error in S3 request'))
      }
      return callback()
    })
  },

  _s3DocToMongoDoc(buffer, callback) {
    if (callback == null) {
      callback = function (error, mongo_doc) {}
    }
    let doc
    try {
      doc = JSON.parse(buffer.toString())
    } catch (error) {
      return callback(error)
    }
    const mongo_doc = {}
    if (doc.schema_v === 1 && doc.lines != null) {
      mongo_doc.lines = doc.lines
      if (doc.ranges != null) {
        mongo_doc.ranges = RangeManager.jsonRangesToMongo(doc.ranges)
      }
    } else if (doc instanceof Array) {
      mongo_doc.lines = doc
    } else {
      return callback(new Error("I don't understand the doc format in s3"))
    }
    return callback(null, mongo_doc)
  },

  _mongoDocToS3Doc(doc, callback) {
    if (callback == null) {
      callback = function (error, s3_doc) {}
    }
    if (doc.lines == null) {
      return callback(new Error('doc has no lines'))
    }
    const json = JSON.stringify({
      lines: doc.lines,
      ranges: doc.ranges,
      schema_v: 1
    })
    if (json.indexOf('\u0000') !== -1) {
      const error = new Error('null bytes detected')
      logger.err({ err: error, doc, json }, error.message)
      return callback(error)
    }
    return callback(null, json)
  }
}
