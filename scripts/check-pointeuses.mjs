import { readFile } from 'node:fs/promises';
import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export function checkTcp(device, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;
    const finish = (reachable, reason) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ ...device, reachable, reason });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'Port TCP accessible'));
    socket.once('timeout', () => finish(false, `Aucune reponse apres ${timeoutMs} ms`));
    socket.once('error', (error) => finish(false, error.code || 'Erreur reseau'));
    socket.connect(device.port, device.host);
  });
}

// ZKTeco session headers: CONNECT (1000) and EXIT (1001) only.
// Protocol reference: https://github.com/fananimi/pyzk/blob/master/zk/base.py
export function createZkSessionPacket(command, sessionId = 0, previousReplyId = 65534) {
  const packet = Buffer.alloc(8);
  packet.writeUInt16LE(command, 0);
  packet.writeUInt16LE(sessionId, 4);
  packet.writeUInt16LE(previousReplyId, 6);
  let sum = command + sessionId + previousReplyId;
  while (sum > 65535) sum -= 65535;
  packet.writeUInt16LE((65534 - sum + 65535) % 65535, 2);
  packet.writeUInt16LE((previousReplyId + 1) % 65535, 6);
  return packet;
}

export function checkZkUdp(device, timeoutMs = 5000) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    let finished = false;
    const finish = (reachable, reason, zkProtocol = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve({ ...device, protocol: 'UDP', reachable, zkProtocol, reason });
    };
    const timer = setTimeout(() => finish(false, `Aucune reponse UDP apres ${timeoutMs} ms`), timeoutMs);
    socket.once('error', error => finish(false, error.code || 'Erreur UDP'));
    socket.on('message', (packet, remote) => {
      if (finished || remote.address !== device.host || remote.port !== device.port) return;
      let sum = 0;
      for (let i = 0; i < packet.length; i += 2) {
        sum += i + 1 < packet.length ? packet.readUInt16LE(i) : packet[i];
      }
      const command = packet.length >= 8 ? packet.readUInt16LE(0) : -1;
      if (packet.length < 8 || sum % 65535 !== 0 || ![2000, 2001, 2005, 65535, 65533, 65532, 65531].includes(command)) {
        finish(true, 'Reponse UDP recue, protocole ZKTeco non confirme');
        return;
      }
      if (command === 2000) {
        // End only the diagnostic session; never disable the terminal or clear data.
        const exitPacket = createZkSessionPacket(1001, packet.readUInt16LE(4), packet.readUInt16LE(6));
        socket.send(exitPacket, device.port, device.host, () => finish(true, 'Pointeuse ZKTeco joignable en UDP', true));
      } else {
        finish(true, command === 2005
          ? 'Pointeuse joignable, cle de communication requise'
          : `Pointeuse joignable, connexion refusee (code ${command})`, true);
      }
    });
    socket.send(createZkSessionPacket(1000), device.port, device.host);
  });
}

async function main() {
  const useUdp = process.argv.includes('--udp');
  const config = JSON.parse(await readFile(new URL('../config/pointeuses.json', import.meta.url), 'utf8'));
  if (!Array.isArray(config.devices) || !config.devices.length
    || !Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 10000
    || config.devices.some(device => !device.name || !net.isIPv4(device.host)
      || !Number.isInteger(device.port) || device.port < 1 || device.port > 65535)) {
    throw new Error('Configuration invalide dans config/pointeuses.json.');
  }

  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    addresses.filter(address => address.family === 'IPv4' && !address.internal)
      .map(address => ({ name, address: address.address, netmask: address.netmask })),
  );
  console.log('Interfaces reseau de ce PC :');
  console.table(interfaces);
  const results = await Promise.all(config.devices.map(device => useUdp
    ? checkZkUdp(device, Math.max(5000, config.timeoutMs))
    : checkTcp(device, config.timeoutMs)));
  console.log(useUdp
    ? 'Test UDP ZKTeco : ouverture puis fermeture de session uniquement, sans lecture des pointages ni modification des appareils.'
    : 'Test TCP uniquement : aucune commande de lecture ou modification des pointeuses.');
  console.table(results);
  console.log('Ce diagnostic ne confirme pas la synchronisation des pointages. Une absence de reponse ne signifie pas que la pointeuse est eteinte.');
  if (results.some(result => !result.reachable)) {
    console.log('Verifier les IP et ports dans ZKTime.Net, puis le routage et le pare-feu avec le service informatique MYC.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
