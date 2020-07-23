const { promisify, callbackify } = require('util')
const MongoManager = require('./MongoManager')
const Errors = require('./Errors')
const logger = require('logger-sharelatex')
const settings = require('settings-sharelatex')
const crypto = require('crypto')
const Streamifier = require('streamifier')
const RangeManager = require('./RangeManager')
const PersistorManager = require('./PersistorManager')
const AsyncPool = require('tiny-async-pool')

const PARALLEL_JOBS = 5

module.exports = {
  archiveAllDocs: callbackify(archiveAllDocs),
  archiveDoc: callbackify(archiveDoc),
  unArchiveAllDocs: callbackify(unArchiveAllDocs),
  unarchiveDoc: callbackify(unarchiveDoc),
  destroyAllDocs: callbackify(destroyAllDocs),
  destroyDoc: callbackify(destroyDoc),
  promises: {
    archiveAllDocs,
    archiveDoc,
    unArchiveAllDocs,
    unarchiveDoc,
    destroyAllDocs,
    destroyDoc
  }
}

async function archiveAllDocs(projectId) {
  const docs = await promisify(MongoManager.getProjectsDocs)(
    projectId,
    { include_deleted: true },
    { lines: true, ranges: true, rev: true, inS3: true }
  )

  if (!docs) {
    throw new Errors.NotFoundError(`No docs for project ${projectId}`)
  }

  await AsyncPool(
    PARALLEL_JOBS,
    docs.filter((doc) => !doc.inS3),
    (doc) => archiveDoc(projectId, doc)
  )
}

async function archiveDoc(projectId, doc) {
  logger.log(
    { project_id: projectId, doc_id: doc._id },
    'sending doc to persistor'
  )
  const key = `${projectId}/${doc._id}`

  if (doc.lines == null) {
    throw new Error('doc has no lines')
  }

  const json = JSON.stringify({
    lines: doc.lines,
    ranges: doc.ranges,
    schema_v: 1
  })

  // this should never happen, but protects against memory-corruption errors that
  // have happened in the past
  if (json.indexOf('\u0000') > -1) {
    const error = new Error('null bytes detected')
    logger.err({ err: error, doc }, error.message)
    throw error
  }

  const md5 = crypto.createHash('md5').update(json).digest('hex')
  const stream = Streamifier.createReadStream(json)
  await PersistorManager.sendStream(settings.docstore.bucket, key, stream, {
    sourceMd5: md5
  })
  await promisify(MongoManager.markDocAsArchived)(doc._id, doc.rev)
}

async function unArchiveAllDocs(projectId) {
  const docs = await promisify(MongoManager.getArchivedProjectDocs)(projectId)
  if (!docs) {
    throw new Errors.NotFoundError(`No docs for project ${projectId}`)
  }
  await AsyncPool(PARALLEL_JOBS, docs, (doc) =>
    unarchiveDoc(projectId, doc._id)
  )
}

async function unarchiveDoc(projectId, docId) {
  logger.log(
    { project_id: projectId, doc_id: docId },
    'getting doc from persistor'
  )
  const key = `${projectId}/${docId}`
  const sourceMd5 = await PersistorManager.getObjectMd5Hash(
    settings.docstore.bucket,
    key
  )
  const stream = await PersistorManager.getObjectStream(
    settings.docstore.bucket,
    key
  )
  stream.resume()
  const json = await _streamToString(stream)
  const md5 = crypto.createHash('md5').update(json).digest('hex')
  if (sourceMd5 !== md5) {
    throw new Errors.Md5MismatchError('md5 mismatch when downloading doc', {
      key,
      sourceMd5,
      md5
    })
  }

  const doc = JSON.parse(json)

  const mongoDoc = {}
  if (doc.schema_v === 1 && doc.lines != null) {
    mongoDoc.lines = doc.lines
    if (doc.ranges != null) {
      mongoDoc.ranges = RangeManager.jsonRangesToMongo(doc.ranges)
    }
  } else if (Array.isArray(doc)) {
    mongoDoc.lines = doc
  } else {
    throw new Error("I don't understand the doc format in s3")
  }
  await promisify(MongoManager.upsertIntoDocCollection)(
    projectId,
    docId,
    mongoDoc
  )
  await PersistorManager.deleteObject(settings.docstore.bucket, key)
}

async function destroyAllDocs(projectId) {
  const docs = await promisify(MongoManager.getProjectsDocs)(
    projectId,
    { include_deleted: true },
    { _id: 1 }
  )
  if (docs) {
    await AsyncPool(PARALLEL_JOBS, docs, (doc) =>
      destroyDoc(projectId, doc._id)
    )
  }
}

async function destroyDoc(projectId, docId) {
  logger.log(
    { project_id: projectId, doc_id: docId },
    'removing doc from mongo and persistor'
  )
  const doc = await promisify(MongoManager.findDoc)(projectId, docId, {
    inS3: 1
  })
  if (!doc) {
    throw new Errors.NotFoundError('Doc not found in Mongo')
  }

  if (doc.inS3) {
    await PersistorManager.deleteObject(
      settings.docstore.bucket,
      `${projectId}/${docId}`
    )
  }
  await promisify(MongoManager.destroyDoc)(docId)
}

async function _streamToString(stream) {
  const chunks = []
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}
