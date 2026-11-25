import net from 'node:net'

const server = net.createServer((client) => {
  const broker = net.connect(1883, '127.0.0.1')
  client.pipe(broker)
  broker.pipe(client)
  client.on('error', () => broker.destroy())
  broker.on('error', () => client.destroy())
  client.on('close', () => broker.destroy())
  broker.on('close', () => client.destroy())
})

server.listen(1884, '0.0.0.0')
