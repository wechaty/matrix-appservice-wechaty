import {
  Room as WechatyRoom,
  Contact as WechatyUser,
  Wechaty,
  Message,
}                             from 'wechaty'

import {
  MatrixRoom,
  MatrixUser,
}                             from 'matrix-appservice-bridge'

import {
  log,
}                            from './config'
import { WechatyManager }     from './wechaty-manager'
import { AppserviceManager }  from './appservice-manager'
import { Manager } from './manager'

interface WechatyRoomData {
  consumerId?: string   // the matrix user id who is using the matrix-appservice-wechaty

  direct?: boolean  // whether the room is a direct message room

  /*
   * 1. If matrixUserId is set, then this room is a direct message room, between the consumerId and matrixUserId
   */
  matrixUserId? : string // for a direct message room (user to user private message, exactly 2 people)
  /**
   * 2. If wechatyRoomId is set, then this room is a group room, linked to the wechatyRoomId as well.
   */
  wechatyRoomId? : string // for a group room (not direct message, >2 people)
}

interface WechatyUserData {
  consumerId    : string  // the matrix user who is using the matrix-appservice-wechaty
  wechatyUserId : string  // the wechaty contact id that this user linked to
}

interface DirectMessageUserPair {
  user    : MatrixUser,
  service : MatrixUser,
}

const APPSERVICE_NAME_POSTFIX = '(Wechaty Bridged)'

const WECHATY_ROOM_DATA_KEY = 'wechatyBridgeRoom'
const WECHATY_USER_DATA_KEY = 'wechatyBridgeUser'

export class MiddleManager extends Manager {

  private wechatyManager!: WechatyManager
  private appserviceManager!: AppserviceManager

  constructor () {
    super()
  }

  teamManager (managers: {
    wechatyManager    : WechatyManager,
    appserviceManager : AppserviceManager,
  }) {
    this.wechatyManager    = managers.wechatyManager
    this.appserviceManager = managers.appserviceManager
  }

  public async matrixUser (wechatyUser: WechatyUser) : Promise<MatrixUser>
  public async matrixUser (matrixUserId: string)     : Promise<MatrixUser>

  public async matrixUser (
    user: string | WechatyUser,
  ): Promise<MatrixUser> {
    log.verbose('MiddleManager', 'matrixUser(%s)', user)

    if (typeof user === 'string') {
      let matrixUser = await this.appserviceManager.userStore.getMatrixUser(user)
      if (!matrixUser) {
        matrixUser = new MatrixUser(user)
        await this.appserviceManager.userStore.setMatrixUser(matrixUser)
      }
      return matrixUser
    }

    const wechaty    = user.wechaty
    const consumerId = this.wechatyManager.matrixConsumerId(wechaty)

    const userData: WechatyUserData = {
      consumerId,
      wechatyUserId: user.id,
    }

    const query = this.appserviceManager.storeQuery(
      WECHATY_USER_DATA_KEY,
      userData,
    )

    const matrixUserList = await this.appserviceManager.userStore
      .getByMatrixData(query)

    const matrixUser = matrixUserList.length > 0
      ? matrixUserList[0]
      : this.generateMatrixUser(user, userData)

    return matrixUser
  }

  /**
   * Get wechaty.userSelf() for consumerId
   */
  public async wechatyUser (consumerId: string) : Promise<WechatyUser>
  /**
   * Get binded wechaty contact from the direct message room
   */
  public async wechatyUser (room: MatrixRoom)   : Promise<WechatyUser>
  /**
   * Get the mapped wechaty contact from the matrix user
   */
  public async wechatyUser (user: MatrixUser)   : Promise<WechatyUser>

  public async wechatyUser (
    idOrRoomOrUser: string | MatrixRoom | MatrixUser,
  ): Promise<WechatyUser> {
    log.verbose('MiddleManager', 'wechatyUser(%s)',
      typeof idOrRoomOrUser === 'string'
        ? idOrRoomOrUser
        : idOrRoomOrUser.getId(),
    )

    let matchKey: string

    if (typeof idOrRoomOrUser === 'string') {

      const wechaty = this.wechatyManager.wechaty(idOrRoomOrUser)
      if (!wechaty) {
        throw new Error('no wechaty instance for matrix user id ' + idOrRoomOrUser)
      }
      return wechaty.userSelf()

    } else if (idOrRoomOrUser instanceof MatrixRoom) {
      matchKey = WECHATY_ROOM_DATA_KEY
    } else if (idOrRoomOrUser instanceof MatrixUser) {
      matchKey = WECHATY_USER_DATA_KEY
    } else {
      throw new Error('unknown args')
    }

    const data = {
      ...idOrRoomOrUser.get(matchKey),
    } as Partial<WechatyUserData>

    if (!data.consumerId) {
      throw new Error('no owner id for matrix room ' + idOrRoomOrUser.getId())
    }
    if (!data.wechatyUserId) {
      throw new Error('no wechaty user id for matrix room ' + idOrRoomOrUser.getId())
    }

    const consumerId       = data.consumerId
    const wechatyUserId = data.wechatyUserId

    const wechaty = this.wechatyManager.wechaty(consumerId)
    if (!wechaty) {
      throw new Error('no wechaty instance for matrix user id ' + consumerId)
    }

    const wechatyContact = await wechaty.Contact
      .find({ id: wechatyUserId })

    if (!wechatyContact) {
      throw new Error('no wechaty contact found for id: ' + wechatyUserId)
    }
    return wechatyContact
  }

  /**
   * Group Room
   */
  public async matrixRoom (wechatyRoom: WechatyRoom): Promise<MatrixRoom>
  /**
   * Direct Message Room
   */
  public async matrixRoom (wechatyUser: WechatyUser): Promise<MatrixRoom>

  public async matrixRoom (
    wechatyUserOrRoom: WechatyUser | WechatyRoom,
  ): Promise<MatrixRoom> {
    log.verbose('MiddleManager', 'matrixRoom(%s)', wechatyUserOrRoom)

    const consumerId = this.wechatyManager.matrixConsumerId(wechatyUserOrRoom.wechaty)

    const data = { consumerId } as WechatyRoomData

    if (wechatyUserOrRoom instanceof WechatyUser) {
      const matrixUser = await this.matrixUser(wechatyUserOrRoom)

      data.matrixUserId = matrixUser.getId()
      data.direct       = true

    } else if (wechatyUserOrRoom instanceof WechatyRoom) {

      data.wechatyRoomId = wechatyUserOrRoom.id
      data.direct        = false

    } else {
      throw new Error('unknown args')
    }

    const query = this.appserviceManager.storeQuery(
      WECHATY_ROOM_DATA_KEY,
      data,
    )

    const entryList = await this.appserviceManager.roomStore
      .getEntriesByMatrixRoomData(query)

    const matrixRoom = entryList.length > 0
      ? entryList[0].matrix
      : await this.generateMatrixRoom(wechatyUserOrRoom, data)

    if (!matrixRoom) {
      throw new Error('get matrix room failed')
    }
    return matrixRoom
  }

  public async wechatyRoom (
    room: MatrixRoom,
  ): Promise<WechatyRoom> {
    log.verbose('MiddleManager', 'wechatyRoom(%s)', room.getId())

    const {
      consumerId,
      wechatyRoomId,
    } = {
      ...room.get(WECHATY_ROOM_DATA_KEY),
    } as WechatyRoomData

    if (!wechatyRoomId) {
      throw new Error('no wechaty room id for matrix room ' + room.getId())
    }
    if (!consumerId) {
      throw new Error('no owner id for matrix room ' + room.getId())
    }

    const wechaty = this.wechatyManager.wechaty(consumerId)
    if (!wechaty) {
      throw new Error('no wechaty instance for matrix user id ' + room.getId())
    }

    const wechatyRoom = await wechaty.Room
      .find({ id: wechatyRoomId })
    if (!wechatyRoom) {
      throw new Error('no wechaty room found for id: ' + wechatyRoomId)
    }
    return wechatyRoom
  }

  protected async generateMatrixUser (
    wechatyUser : WechatyUser,
    userData    : WechatyUserData,
  ): Promise<MatrixUser> {
    log.verbose('MiddleManager', 'generateMatrixUser(%s, "%s")',
      wechatyUser.id,
      JSON.stringify(userData),
    )

    const matrixUserId = this.appserviceManager.generateVirtualUserId()
    const matrixUser   = new MatrixUser(matrixUserId)

    // userData.name   = wechatyUser.name() + APPSERVICE_NAME_POSTFIX

    matrixUser.set(WECHATY_USER_DATA_KEY, userData)
    await this.appserviceManager.userStore.setMatrixUser(matrixUser)

    return matrixUser
  }

  /**
   * Room: Group Room
   * User: Direct Message Room
   */
  protected async generateMatrixRoom (
    wechatyRoomOrUser : WechatyRoom | WechatyUser,
    roomData          : WechatyRoomData,
  ): Promise<MatrixRoom> {
    log.verbose('MiddleManager', 'generateMatrixRoom(%s, %s)',
      wechatyRoomOrUser,
      JSON.stringify(roomData),
    )

    const wechaty = wechatyRoomOrUser.wechaty
    const consumerId = this.wechatyManager.matrixConsumerId(wechaty)

    const inviteeIdList = [consumerId]
    let   roomName: string
    let   creatorId: string

    if (wechatyRoomOrUser instanceof WechatyRoom) {
      // Room: group
      creatorId = this.appserviceManager.appserviceUserId()
      roomName = await wechatyRoomOrUser.topic()
      for await (const member of wechatyRoomOrUser) {
        const matrixUser = await this.matrixUser(member)
        inviteeIdList.push(matrixUser.getId())
      }
    } else if (wechatyRoomOrUser instanceof WechatyUser) {
      // User: direct message
      roomName = wechatyRoomOrUser.name()
      const matrixUser = await this.matrixUser(wechatyRoomOrUser)
      creatorId = matrixUser.getId()
      inviteeIdList.push(matrixUser.getId())
    } else {
      throw new Error('unknown args')
    }

    const matrixRoom = await this.appserviceManager.createRoom(
      inviteeIdList,
      {
        creatorId,
        name: roomName,
        topic: APPSERVICE_NAME_POSTFIX,
      },
    )

    matrixRoom.set(WECHATY_ROOM_DATA_KEY, roomData)
    await this.appserviceManager.roomStore.setMatrixRoom(matrixRoom)

    return matrixRoom
  }

  public async setDirectMessageRoom (
    matrixRoom : MatrixRoom,
    data       : WechatyRoomData,
  ) {
    log.verbose('MiddleManager', 'setDirectMessageRoom("%s", "%s")',
      matrixRoom.getId(),
      JSON.stringify(data),
    )

    matrixRoom.set(
      WECHATY_ROOM_DATA_KEY,
      {
        ...matrixRoom.get(WECHATY_ROOM_DATA_KEY),
        ...data,
        direct       : true,
      } as WechatyRoomData,
    )
    await this.appserviceManager.roomStore.setMatrixRoom(matrixRoom)
  }

  /**
   * See: Issue #4 - https://github.com/wechaty/matrix-appservice-wechaty/issues/4
   *  - https://github.com/matrix-org/matrix-js-sdk/issues/653#issuecomment-420808454
   */
  public async isDirectMessageRoom (
    matrixRoom: MatrixRoom,
  ): Promise<boolean> {
    log.verbose('MiddleManager', 'isDirectMessageRoom(%s)', matrixRoom.getId())

    // // getMyMembership -> "invite", "join", "leave", "ban"
    // const membership = matrixRoom.getMyMembership()
    // const type = matrixRoom.getDMInviter() ? 'directMessage' : 'room'
    // return membership === 'invite' && type === 'directMessage'

    const roomData = {
      ...matrixRoom.get(WECHATY_ROOM_DATA_KEY),
    } as Partial<WechatyRoomData>

    /**
     * If the room has no direct data set, then set it for the first time.
     */
    if (typeof roomData.direct === 'undefined') {
      log.silly('MiddleManager', 'isDirectMessageRoom(%s) not initialized', matrixRoom.getId())

      // default not a direct room
      roomData.direct = false

      const memberIdList = await this.appserviceManager
        .roomMembers(matrixRoom.getId())

      if (memberIdList.length === 2) {
        log.silly('MiddleManager', 'isDirectMessageRoom(%s) has 2 members', matrixRoom.getId())

        const botId = this.appserviceManager.appserviceUserId()
        const i = memberIdList.indexOf(botId)
        if (i > -1) {
          log.silly('MiddleManager', 'isDirectMessageRoom(%s) has 2 members that includes the bot, confirmed a direct message room', matrixRoom.getId())

          roomData.matrixUserId = memberIdList.splice(i, 1)[0]
          roomData.consumerId   = memberIdList[0]
          /**
             * Direct Message Room
             */
          roomData.direct = true

        }
      }

      await this.setDirectMessageRoom(matrixRoom, roomData)
    }

    log.silly('MiddleManager', 'isDirectMessageRoom() -> %s', roomData.direct)
    return roomData.direct
  }

  /**
   * FIXME: Huan(202003) study how to know a matrix room is direct message room
   */
  protected async fixmeTest (matrixRoom: MatrixRoom): Promise<void> {
    const botId = this.appserviceManager.appserviceUserId()
    const client = this.appserviceManager.bridge.getClientFactory().getClientAs()

    const stateList = await client.roomState(matrixRoom.getId()) as unknown as any[]
    console.info('state:',
      stateList.filter(state =>
        state.prev_content && state.prev_content.is_direct
        && [
          state.sender,
          state.state_key,
          state.user_id,
        ].every(s => s === botId)
      )
    )

    // const event = await this.appserviceManager.bridge.getIntent().getStateEvent(
    //   matrixRoom.getId(),
    //   'm.room.member',
    //   // '@wechaty:0v0.bid',
    // )
    // console.info('event:', event)

  }

  public async directMessageUserPair (
    matrixRoom: MatrixRoom,
  ): Promise<DirectMessageUserPair> {
    log.verbose('MiddleManager', 'directMessageUserPair(%s)', matrixRoom.getId())

    const {
      consumerId,
      matrixUserId,
    } = {
      ...matrixRoom.get(WECHATY_ROOM_DATA_KEY),
    } as WechatyRoomData

    if (!matrixUserId) {
      throw new Error('no matrix user id found)')
    }
    if (!consumerId) {
      throw new Error('no consumer id found')
    }

    const service = await this.matrixUser(matrixUserId)
    const user    = await this.matrixUser(consumerId)

    return {
      service,
      user,
    }
  }

  /**
   * Send message from service bot to the bridge consumer
   */
  public async directMessageToMatrixConsumer (message: string, from: Wechaty): Promise<void>
  /**
   * Send message from user to the bridge consumer
   */
  public async directMessageToMatrixConsumer (message: string, from: WechatyUser): Promise<void>
  public async directMessageToMatrixConsumer (message: Message, from: WechatyUser): Promise<void>

  public async directMessageToMatrixConsumer (
    message: string | Message,
    from: WechatyUser | Wechaty,
  ): Promise<void> {
    const text = typeof (message) === 'string' ? message : message.text()
    log.verbose('MiddleManager', 'directMessageToMatrixConsumer("%s", "%s")',
      text,
      from
    )

    let matrixRoom
    let matrixUser

    if (from instanceof WechatyUser) {

      matrixRoom = await this.matrixRoom(from)
      matrixUser = await this.matrixUser(from)

    } else if (from instanceof Wechaty) {

      const consumerId = this.wechatyManager.matrixConsumerId(from)
      matrixRoom = await this.adminRoom(consumerId)

    } else {
      throw new Error('unknown args')
    }

    await this.appserviceManager.sendMessage(
      message,
      matrixRoom,
      matrixUser,
    )
  }

  /**
   * Direct Message Room from AppService Bot to Matrix Consumer (User)
   */
  public async adminRoom (
    forConsumerIdOrWechaty: string | Wechaty,
  ): Promise<MatrixRoom> {
    log.verbose('AppserviceManager', 'adminRoom(%s)', forConsumerIdOrWechaty)

    const botId = this.appserviceManager.appserviceUserId()
    let consumerId: string

    if (forConsumerIdOrWechaty instanceof Wechaty)  {
      consumerId = this.wechatyManager.matrixConsumerId(forConsumerIdOrWechaty)
    } else {
      consumerId = forConsumerIdOrWechaty
    }

    const roomData: WechatyRoomData = {
      consumerId,
      matrixUserId: botId,
    }

    const query = this.appserviceManager.storeQuery(
      WECHATY_ROOM_DATA_KEY,
      roomData,
    )

    const matrixRoomList = await this.appserviceManager.roomStore
      .getEntriesByMatrixRoomData(query)

    let matrixRoom: MatrixRoom

    if (matrixRoomList.length > 0) {
      if (!matrixRoomList[0].matrix) {
        throw new Error(`matrix room not found for roomData: "${JSON.stringify(roomData)}`)
      }
      matrixRoom = matrixRoomList[0].matrix

    } else {
      matrixRoom = await this.appserviceManager.createRoom(
        [botId, consumerId],
        {
          creatorId: botId,
          name: 'Wechaty AppService Bot',
          topic: 'Wechaty AppService Management',
        },
      )
      matrixRoom.set(WECHATY_ROOM_DATA_KEY, roomData)
      await this.appserviceManager.roomStore.setMatrixRoom(matrixRoom)
    }
    return matrixRoom
  }

}
