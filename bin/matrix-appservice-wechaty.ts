#!/usr/bin/env node

import {
  checkUpdate,
  createCli,
  log,
  VERSION,
}                     from '../src/'
import dotenv         from 'dotenv'

dotenv.config()
async function main () {
  if (process.env.LOG_LEVEL) {
    log.level(process.env.LOG_LEVEL as any)
  }

  log.info('matrix-appservice-wechaty', `v${VERSION}`)

  checkUpdate()

  process.on('warning', (warning) => {
    log.warn('matrix-appservice-wechaty', 'process.on(warning)')
    console.warn(warning.name)    // Print the warning name
    console.warn(warning.message) // Print the warning message
    console.warn(warning.stack)   // Print the stack trace
  })

  /**
   * To show a nice name from CLI, instead of `node`
   */
  process.argv[0] = 'matrix-appservice-wechaty'

  const cli = await createCli()
  cli.run()
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
