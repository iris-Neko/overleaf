import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import ChatApiHandler from './ChatApiHandler.mjs'
import ChatManager from './ChatManager.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import UserInfoManager from '../User/UserInfoManager.mjs'
import UserInfoController from '../User/UserInfoController.mjs'
import DocumentUpdaterHandler from '../DocumentUpdater/DocumentUpdaterHandler.mjs'

// Backend for the review-panel comment threads. In Server Pro this lives in the
// `track-changes` module; Community Edition ships without that module, so the
// review-panel HTTP endpoints (which the frontend always calls) would otherwise
// be unhandled and every "Add comment" action would fail. These handlers wire
// the existing ChatApiHandler proxy to the routes the frontend expects.

async function sendComment(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }
  logger.debug({ projectId, threadId, userId }, 'sending comment')
  const comment = await ChatApiHandler.promises.sendComment(
    projectId,
    threadId,
    userId,
    content
  )
  const user = await UserInfoManager.promises.getPersonalInfo(comment.user_id)
  comment.user = UserInfoController.formatPersonalInfo(user)
  EditorRealTimeController.emitToRoom(
    projectId,
    'new-comment',
    threadId,
    comment
  )
  res.sendStatus(204)
}

async function getThreads(req, res) {
  const { project_id: projectId } = req.params
  logger.debug({ projectId }, 'getting comment threads for project')
  const threads = await ChatApiHandler.promises.getThreads(projectId)
  await ChatManager.promises.injectUserInfoIntoThreads(threads)
  res.json(threads)
}

async function resolveThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }
  logger.debug({ projectId, docId, threadId, userId }, 'resolving comment thread')
  await DocumentUpdaterHandler.promises.resolveThread(
    projectId,
    docId,
    threadId,
    userId
  )
  await ChatApiHandler.promises.resolveThread(projectId, threadId, userId)
  const user = await UserInfoManager.promises.getPersonalInfo(userId)
  EditorRealTimeController.emitToRoom(
    projectId,
    'resolve-thread',
    threadId,
    UserInfoController.formatPersonalInfo(user)
  )
  res.sendStatus(204)
}

async function reopenThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }
  logger.debug({ projectId, docId, threadId }, 'reopening comment thread')
  await DocumentUpdaterHandler.promises.reopenThread(
    projectId,
    docId,
    threadId,
    userId
  )
  await ChatApiHandler.promises.reopenThread(projectId, threadId)
  EditorRealTimeController.emitToRoom(projectId, 'reopen-thread', threadId)
  res.sendStatus(204)
}

async function deleteThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  logger.debug({ projectId, docId, threadId }, 'deleting comment thread')
  await DocumentUpdaterHandler.promises.deleteThread(
    projectId,
    docId,
    threadId,
    userId
  )
  await ChatApiHandler.promises.deleteThread(projectId, threadId)
  EditorRealTimeController.emitToRoom(projectId, 'delete-thread', threadId)
  res.sendStatus(204)
}

async function editMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }
  logger.debug({ projectId, threadId, messageId }, 'editing message')
  await ChatApiHandler.promises.editMessage(
    projectId,
    threadId,
    messageId,
    userId,
    content
  )
  EditorRealTimeController.emitToRoom(
    projectId,
    'edit-message',
    threadId,
    messageId,
    content
  )
  res.sendStatus(204)
}

async function deleteMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  logger.debug({ projectId, threadId, messageId }, 'deleting message')
  await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId)
  EditorRealTimeController.emitToRoom(
    projectId,
    'delete-message',
    threadId,
    messageId
  )
  res.sendStatus(204)
}

async function deleteOwnMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }
  logger.debug({ projectId, threadId, messageId, userId }, 'deleting own message')
  await ChatApiHandler.promises.deleteUserMessage(
    projectId,
    threadId,
    userId,
    messageId
  )
  EditorRealTimeController.emitToRoom(
    projectId,
    'delete-message',
    threadId,
    messageId
  )
  res.sendStatus(204)
}

export default {
  sendComment: expressify(sendComment),
  getThreads: expressify(getThreads),
  resolveThread: expressify(resolveThread),
  reopenThread: expressify(reopenThread),
  deleteThread: expressify(deleteThread),
  editMessage: expressify(editMessage),
  deleteMessage: expressify(deleteMessage),
  deleteOwnMessage: expressify(deleteOwnMessage),
}
