import { connect, type MqttClient } from 'mqtt'
import { describe, expect, test } from 'vitest'
import { buildEnvelope, buildTopic } from '../../src/mqtt/envelope'

const brokerUrl = process.env.MQTT_INTEGRATION_URL

function waitForConnection(client: MqttClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MQTT integration connection timed out')), 8000)
    client.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    client.once('error', () => {
      clearTimeout(timer)
      reject(new Error('MQTT integration connection failed'))
    })
  })
}

describe('Mosquitto MQTT integration', () => {
  test.skipIf(!brokerUrl)('broker delivers the envelope on the exact expected topic', async () => {
    const topic = buildTopic('dev-events', 'integration', true)
    const subscriber = connect(brokerUrl as string, {
      clientId: `orca-publisher-subscriber-${crypto.randomUUID()}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 0
    })
    const publisher = connect(brokerUrl as string, {
      clientId: `orca-publisher-publisher-${crypto.randomUUID()}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 0
    })

    try {
      await Promise.all([waitForConnection(subscriber), waitForConnection(publisher)])
      await new Promise<void>((resolve, reject) => {
        subscriber.subscribe(topic, { qos: 0 }, (error) => {
          if (error) {
            reject(new Error('MQTT integration subscription failed'))
          } else {
            resolve()
          }
        })
      })

      const received = new Promise<{ topic: string; message: Buffer }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Mosquitto did not deliver the published envelope')),
          5000
        )
        subscriber.on('message', (receivedTopic, message) => {
          clearTimeout(timer)
          resolve({ topic: receivedTopic, message })
        })
      })
      const envelope = buildEnvelope(
        'devevents.agent.turn.started',
        {},
        'integration',
        undefined,
        new Date('2026-11-25T13:00:00.000Z'),
        '550e8400-e29b-41d4-a716-446655440000'
      )

      await new Promise<void>((resolve, reject) => {
        publisher.publish(topic, JSON.stringify(envelope), { qos: 0 }, (error) => {
          if (error) {
            reject(new Error('MQTT integration publish failed'))
          } else {
            resolve()
          }
        })
      })

      const message = await received
      expect(message.topic).toBe('dev-events/integration')
      expect(JSON.parse(message.message.toString())).toEqual(envelope)
    } finally {
      await Promise.all([subscriber.endAsync(true), publisher.endAsync(true)])
    }
  })
})
