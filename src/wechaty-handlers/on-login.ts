import {
  Contact,
  Wechaty,
}             from 'wechaty'

import {
  log,
}                           from '../config'

import { AppserviceManager }  from '../appservice-manager'

export async function onLogin (
  this: Wechaty,
  user: Contact,
  matrixUserId: string,
  appserviceManager: AppserviceManager,
): Promise<void> {
  log.verbose('wechaty-handlers', 'on-login onLogin(%s, %s)', user, matrixUserId)

  const intent = appserviceManager.bridge().getIntent()

  const matrixRoomId = await appserviceManager.directMessageRoomId(matrixUserId)

  await intent.sendText(
    matrixRoomId,
    `${user} logout`,
  )

}