#!/usr/bin/env node
/**
 * Realtime Load & Stress Simulation Benchmark
 *
 * Simulates high-concurrency chat rooms and collaborative whiteboards
 * using the production PartyServer/Durable Object architecture.
 *
 * Run with:
 *   npx tsx scripts/benchmark-realtime.ts --rooms 200 --clients 10 --msgs 20 --whiteboards 100 --wb-clients 8 --wb-updates 20
 */

import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { RealtimeRooms, type RoomSocket } from '../src/adapters/node/realtime';
import { RoomDatabase } from '../src/adapters/node/sqlite';
import { accessChannel } from '../src/lib/roomAccess';

interface BenchmarkConfig {
  chatRooms: number;
  clientsPerChatRoom: number;
  messagesPerClient: number;
  whiteboardRooms: number;
  clientsPerWhiteboard: number;
  updatesPerWhiteboardClient: number;
}

const args = process.argv.slice(2);
function getArg(name: string, fallback: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) {
    const val = parseInt(args[idx + 1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return fallback;
}

const config: BenchmarkConfig = {
  chatRooms: getArg('rooms', 100),
  clientsPerChatRoom: getArg('clients', 10),
  messagesPerClient: getArg('msgs', 10),
  whiteboardRooms: getArg('whiteboards', 50),
  clientsPerWhiteboard: getArg('wb-clients', 8),
  updatesPerWhiteboardClient: getArg('wb-updates', 15),
};

// Cap clients per room at 32 (protocol limit)
config.clientsPerChatRoom = Math.min(32, config.clientsPerChatRoom);
config.clientsPerWhiteboard = Math.min(32, config.clientsPerWhiteboard);

class BenchSocket implements RoomSocket {
  sent: any[] = [];
  closed: number | null = null;
  onReceive?: (msg: any) => void;

  send(data: string) {
    try {
      const parsed = JSON.parse(data);
      this.sent.push(parsed);
      this.onReceive?.(parsed);
    } catch {}
  }

  close(code?: number) {
    this.closed = code ?? 1000;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function runBenchmark() {
  console.log('='.repeat(70));
  console.log('🚀 ENCRYPT.CLICK REALTIME LOAD BENCHMARK & STRESS SIMULATION');
  console.log('='.repeat(70));
  console.log(`Configuration:`);
  console.log(`  • Chat Rooms:              ${config.chatRooms} rooms × ${config.clientsPerChatRoom} clients (${config.chatRooms * config.clientsPerChatRoom} total clients)`);
  console.log(`  • Messages per client:     ${config.messagesPerClient} msgs`);
  console.log(`  • Whiteboard Rooms:        ${config.whiteboardRooms} rooms × ${config.clientsPerWhiteboard} clients (${config.whiteboardRooms * config.clientsPerWhiteboard} total clients)`);
  console.log(`  • Updates per WB client:   ${config.updatesPerWhiteboardClient} updates (doc, cursor, laser)`);
  console.log(`  • Room storage:            SQLite (room configs and alarms only, no message history)`);
  console.log('='.repeat(70));

  const tmpPath = mkdtempSync(path.join(tmpdir(), 'ec-bench-'));
  const db = new RoomDatabase(path.join(tmpPath, 'rooms.sqlite'));
  const rooms = new RealtimeRooms(db, {}, 60_000);

  const memStart = process.memoryUsage();
  const startTime = performance.now();

  // ----------------------------------------------------
  // PHASE 1: CHAT BENCHMARK
  // ----------------------------------------------------
  console.log('\n💬 [Phase 1/2] Launching Chat Rooms Stress Test...');
  let totalChatSent = 0;
  let totalChatDelivered = 0;
  const chatSentTimes = new Map<string, number>();
  const latencies: number[] = [];

  const chatTokens: string[] = [];
  const chatRoomNames: string[] = [];
  for (let i = 0; i < config.chatRooms; i++) {
    const tok = 'c'.repeat(32) + i.toString(16).padStart(32, '0');
    chatTokens.push(tok);
    chatRoomNames.push(await accessChannel(tok));
  }

  const roomParty = 'main';
  const chatStart = performance.now();

  interface ChatMember {
    id: string;
    socket: BenchSocket;
    peer: any;
  }

  const activeChatRooms: ChatMember[][] = [];

  // Connect and join all chat clients
  for (let r = 0; r < config.chatRooms; r++) {
    const roomName = chatRoomNames[r];
    const tok = chatTokens[r];
    const members: ChatMember[] = [];

    for (let c = 0; c < config.clientsPerChatRoom; c++) {
      const socket = new BenchSocket();
      const peer = rooms.connect(roomParty, roomName, socket);

      socket.onReceive = (msg) => {
        if (msg.type === 'message' && msg.id && chatSentTimes.has(msg.id)) {
          totalChatDelivered++;
          latencies.push(performance.now() - chatSentTimes.get(msg.id)!);
        }
      };

      peer.message(JSON.stringify({
        type: 'join',
        token: tok,
        config: { mode: 'live', authMode: 'password', createdAt: Date.now(), v: 3 },
      }));

      members.push({ id: `client_${r}_${c}`, socket, peer });
    }
    activeChatRooms.push(members);
  }

  console.log(`  ✓ Successfully established ${config.chatRooms * config.clientsPerChatRoom} concurrent chat connections in ${config.chatRooms} rooms.`);

  // Allow join handshakes to resolve before message storm
  await new Promise(resolve => setTimeout(resolve, 200));

  // Simulate heavy traffic: messages, typing indicators, presence, reactions
  for (let m = 0; m < config.messagesPerClient; m++) {
    for (let r = 0; r < config.chatRooms; r++) {
      const members = activeChatRooms[r];
      // One sender sends a message, others send typing indicators
      const senderIdx = m % members.length;
      const sender = members[senderIdx];

      // Typing indicator
      sender.peer.message(JSON.stringify({ type: 'typing', active: true }));

      // Encrypted message payload simulation (AES-GCM base64 ciphertext ~512 bytes)
      const fakeCiphertext = 'ECLKENC' + 'X'.repeat(480);
      const msgId = `m_${r}_${m}_${senderIdx}`;
      chatSentTimes.set(msgId, performance.now());

      sender.peer.message(JSON.stringify({
        type: 'message',
        id: msgId,
        payload: fakeCiphertext,
      }));
      totalChatSent++;

      // Typing stopped
      sender.peer.message(JSON.stringify({ type: 'typing', active: false }));
    }
  }

  // Allow dispatch queue to settle
  await new Promise(resolve => setTimeout(resolve, 500));
  const chatDuration = (performance.now() - chatStart) / 1000;
  console.log(`  ✓ Chat completed in ${chatDuration.toFixed(2)}s. Sent: ${totalChatSent} messages | Delivered across all peers: ${totalChatDelivered}`);

  // Disconnect chat clients
  for (const members of activeChatRooms) {
    for (const m of members) {
      m.peer.closed();
    }
  }

  // ----------------------------------------------------
  // PHASE 2: WHITEBOARD BENCHMARK
  // ----------------------------------------------------
  console.log('\n🎨 [Phase 2/2] Launching Whiteboard Rooms Stress Test...');
  let totalWbUpdatesSent = 0;
  let totalWbUpdatesDelivered = 0;
  const wbSentTimes = new Map<string, number>();
  const wbLatencies: number[] = [];

  const wbTokens: string[] = [];
  const wbRoomNames: string[] = [];
  for (let i = 0; i < config.whiteboardRooms; i++) {
    const tok = 'b'.repeat(32) + i.toString(16).padStart(32, '0');
    wbTokens.push(tok);
    wbRoomNames.push(await accessChannel(tok));
  }

  const wbParty = 'whiteboard';
  const wbStart = performance.now();

  interface WbMember {
    id: string;
    socket: BenchSocket;
    peer: any;
  }

  const activeWbRooms: WbMember[][] = [];

  for (let r = 0; r < config.whiteboardRooms; r++) {
    const roomName = wbRoomNames[r];
    const tok = wbTokens[r];
    const members: WbMember[] = [];

    for (let c = 0; c < config.clientsPerWhiteboard; c++) {
      const socket = new BenchSocket();
      const peer = rooms.connect(wbParty, roomName, socket);

      socket.onReceive = (msg) => {
        if (msg.type === 'envelope' && msg.id && wbSentTimes.has(msg.id)) {
          totalWbUpdatesDelivered++;
          wbLatencies.push(performance.now() - wbSentTimes.get(msg.id)!);
        }
      };

      peer.message(JSON.stringify({ type: 'join', token: tok }));
      members.push({ id: `wb_client_${r}_${c}`, socket, peer });
    }
    activeWbRooms.push(members);
  }

  console.log(`  ✓ Established ${config.whiteboardRooms * config.clientsPerWhiteboard} concurrent whiteboard sessions.`);

  // Allow join handshakes to resolve before update storm
  await new Promise(resolve => setTimeout(resolve, 200));

  // Simulate drawing, cursor movement, laser trails, shape updates
  for (let u = 0; u < config.updatesPerWhiteboardClient; u++) {
    for (let r = 0; r < config.whiteboardRooms; r++) {
      const members = activeWbRooms[r];
      const drawer = members[u % members.length];

      // 1. Live cursor broadcast
      const curId = `cur_${r}_${u}`;
      wbSentTimes.set(curId, performance.now());
      drawer.peer.message(JSON.stringify({
        type: 'envelope',
        kind: 'cursor',
        payload: 'CPOS' + 'x'.repeat(64),
        id: curId,
      }));

      // 2. CRDT doc stroke update
      const strokeId = `stroke_${r}_${u}`;
      wbSentTimes.set(strokeId, performance.now());
      drawer.peer.message(JSON.stringify({
        type: 'envelope',
        kind: 'doc',
        payload: 'DOCSTROKE' + 'D'.repeat(256),
        id: strokeId,
      }));
      totalWbUpdatesSent += 2;
    }
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  const wbDuration = (performance.now() - wbStart) / 1000;
  console.log(`  ✓ Whiteboard completed in ${wbDuration.toFixed(2)}s. Sent: ${totalWbUpdatesSent} updates | Delivered: ${totalWbUpdatesDelivered}`);

  // Disconnect whiteboard clients
  for (const members of activeWbRooms) {
    for (const m of members) {
      m.peer.closed();
    }
  }

  const totalDuration = (performance.now() - startTime) / 1000;
  const memEnd = process.memoryUsage();

  // Sort latencies for percentiles
  latencies.sort((a, b) => a - b);
  wbLatencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  const wbP50 = wbLatencies[Math.floor(wbLatencies.length * 0.5)] || 0;
  const wbP95 = wbLatencies[Math.floor(wbLatencies.length * 0.95)] || 0;

  console.log('\n' + '='.repeat(70));
  console.log('📊 BENCHMARK RESULTS & PERFORMANCE METRICS');
  console.log('='.repeat(70));
  console.log(`Total Benchmark Time:      ${totalDuration.toFixed(2)} seconds`);
  console.log(`Chat Throughput:           ${Math.round(totalChatSent / chatDuration)} messages sent/sec`);
  console.log(`Chat Broadcast Delivery:   ${Math.round(totalChatDelivered / chatDuration)} deliveries/sec`);
  console.log(`Chat Latency (RTT):        p50: ${p50.toFixed(2)} ms | p95: ${p95.toFixed(2)} ms | p99: ${p99.toFixed(2)} ms`);
  console.log(`Whiteboard Throughput:     ${Math.round(totalWbUpdatesSent / wbDuration)} updates/sec`);
  console.log(`Whiteboard Delivery:       ${Math.round(totalWbUpdatesDelivered / wbDuration)} deliveries/sec`);
  console.log(`Whiteboard Latency:        p50: ${wbP50.toFixed(2)} ms | p95: ${wbP95.toFixed(2)} ms`);
  console.log(`Memory Footprint:          Heap: ${formatBytes(memEnd.heapUsed)} (Δ ${formatBytes(memEnd.heapUsed - memStart.heapUsed)}) | RSS: ${formatBytes(memEnd.rss)}`);
  console.log('='.repeat(70) + '\n');

  await rooms.shutdown();
  db.close();
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
