import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { ContractExtractor, CypherExecutor } from '../contract-extractor.js';
import type { ExtractedContract, RepoHandle } from '../types.js';

type Broker = 'kafka' | 'rabbitmq' | 'nats';

function readSafe(repoPath: string, rel: string): string | null {
  const abs = path.resolve(repoPath, rel);
  const base = path.resolve(repoPath);
  const relToBase = path.relative(base, abs);
  if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) return null;
  try {
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
}

function makeContract(
  topicName: string,
  role: 'provider' | 'consumer',
  filePath: string,
  symbolName: string,
  confidence: number,
  broker: Broker,
): ExtractedContract {
  return {
    contractId: `topic::${topicName}`,
    type: 'topic',
    role,
    symbolUid: '',
    symbolRef: { filePath: filePath.replace(/\\/g, '/'), name: symbolName },
    symbolName,
    confidence,
    meta: {
      broker,
      topicName,
      extractionStrategy: 'source_scan',
    },
  };
}

interface PatternDef {
  regex: RegExp;
  role: 'provider' | 'consumer';
  broker: Broker;
  confidence: number;
  topicGroup: number;
  symbolName: string;
}

// --- Kafka patterns ---
const KAFKA_PATTERNS: PatternDef[] = [
  // Java: @KafkaListener(topics = "xxx")
  {
    regex: /@KafkaListener\s*\(\s*topics\s*=\s*"([^"]+)"/g,
    role: 'consumer',
    broker: 'kafka',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'kafkaListener',
  },
  // Java: kafkaTemplate.send("xxx"
  {
    regex: /kafkaTemplate\.send\s*\(\s*"([^"]+)"/gi,
    role: 'provider',
    broker: 'kafka',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'kafkaTemplate.send',
  },
  // Node: producer.send({ topic: 'xxx'
  {
    regex: /producer\.send\s*\(\s*\{\s*topic:\s*['"]([^'"]+)['"]/g,
    role: 'provider',
    broker: 'kafka',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'producer.send',
  },
  // Node: consumer.subscribe({ topic: 'xxx'
  {
    regex: /consumer\.subscribe\s*\(\s*\{\s*topic:\s*['"]([^'"]+)['"]/g,
    role: 'consumer',
    broker: 'kafka',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'consumer.subscribe',
  },
  // Go: consumer.ConsumePartition("xxx"
  {
    regex: /\.ConsumePartition\s*\(\s*"([^"]+)"/g,
    role: 'consumer',
    broker: 'kafka',
    confidence: 0.7,
    topicGroup: 1,
    symbolName: 'ConsumePartition',
  },
  // Python: KafkaConsumer('xxx'
  {
    regex: /KafkaConsumer\s*\(\s*['"]([^'"]+)['"]/g,
    role: 'consumer',
    broker: 'kafka',
    confidence: 0.7,
    topicGroup: 1,
    symbolName: 'KafkaConsumer',
  },
  // Python: producer.send('xxx' or producer.produce('xxx'
  {
    regex: /producer\.(?:send|produce)\s*\(\s*['"]([^'"]+)['"]/g,
    role: 'provider',
    broker: 'kafka',
    confidence: 0.7,
    topicGroup: 1,
    symbolName: 'producer.send',
  },
];

// --- RabbitMQ patterns ---
const RABBITMQ_PATTERNS: PatternDef[] = [
  // Java: @RabbitListener(queues = "xxx")
  {
    regex: /@RabbitListener\s*\(\s*queues\s*=\s*"([^"]+)"/g,
    role: 'consumer',
    broker: 'rabbitmq',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'rabbitListener',
  },
  // Java: rabbitTemplate.convertAndSend("xxx"
  {
    regex: /rabbitTemplate\.convertAndSend\s*\(\s*"([^"]+)"/gi,
    role: 'provider',
    broker: 'rabbitmq',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'rabbitTemplate.convertAndSend',
  },
  // Node: channel.consume("xxx"
  {
    regex: /channel\.consume\s*\(\s*"([^"]+)"/g,
    role: 'consumer',
    broker: 'rabbitmq',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'channel.consume',
  },
  // Node: channel.publish("xxx"
  {
    regex: /channel\.publish\s*\(\s*"([^"]+)"/g,
    role: 'provider',
    broker: 'rabbitmq',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'channel.publish',
  },
  // Node: channel.sendToQueue("xxx"
  {
    regex: /channel\.sendToQueue\s*\(\s*"([^"]+)"/g,
    role: 'provider',
    broker: 'rabbitmq',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'channel.sendToQueue',
  },
  // Python: channel.basic_consume(queue='xxx'
  {
    regex: /channel\.basic_consume\s*\(\s*queue\s*=\s*['"]([^'"]+)['"]/g,
    role: 'consumer',
    broker: 'rabbitmq',
    confidence: 0.7,
    topicGroup: 1,
    symbolName: 'basic_consume',
  },
  // Python: channel.basic_publish(exchange='xxx'
  {
    regex: /channel\.basic_publish\s*\([^)]*exchange\s*=\s*['"]([^'"]+)['"]/g,
    role: 'provider',
    broker: 'rabbitmq',
    confidence: 0.7,
    topicGroup: 1,
    symbolName: 'basic_publish',
  },
];

// --- NATS patterns ---
const NATS_PATTERNS: PatternDef[] = [
  // Go/Node: nc.Subscribe("xxx" or nc.subscribe("xxx"
  {
    regex: /nc\.(?:S|s)ubscribe\s*\(\s*"([^"]+)"/g,
    role: 'consumer',
    broker: 'nats',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'nc.Subscribe',
  },
  // Go/Node: nc.Publish("xxx" or nc.publish("xxx"
  {
    regex: /nc\.(?:P|p)ublish\s*\(\s*"([^"]+)"/g,
    role: 'provider',
    broker: 'nats',
    confidence: 0.8,
    topicGroup: 1,
    symbolName: 'nc.Publish',
  },
];

const ALL_PATTERNS: PatternDef[] = [...KAFKA_PATTERNS, ...RABBITMQ_PATTERNS, ...NATS_PATTERNS];

export class TopicExtractor implements ContractExtractor {
  type = 'topic' as const;

  async canExtract(_repo: RepoHandle): Promise<boolean> {
    return true;
  }

  async extract(
    _dbExecutor: CypherExecutor | null,
    repoPath: string,
    _repo: RepoHandle,
  ): Promise<ExtractedContract[]> {
    const files = await glob('**/*.{ts,tsx,js,jsx,java,go,py}', {
      cwd: repoPath,
      ignore: ['**/node_modules/**', '**/.git/**', '**/vendor/**', '**/dist/**', '**/build/**'],
      nodir: true,
    });

    const out: ExtractedContract[] = [];
    for (const rel of files) {
      const content = readSafe(repoPath, rel);
      if (!content) continue;
      out.push(...this.scanFile(content, rel));
    }

    return this.dedupe(out);
  }

  private scanFile(content: string, filePath: string): ExtractedContract[] {
    const out: ExtractedContract[] = [];

    for (const pattern of ALL_PATTERNS) {
      // Reset regex state for each file
      const re = new RegExp(pattern.regex.source, pattern.regex.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const topicName = m[pattern.topicGroup];
        if (!topicName) continue;
        out.push(
          makeContract(
            topicName,
            pattern.role,
            filePath,
            pattern.symbolName,
            pattern.confidence,
            pattern.broker,
          ),
        );
      }
    }

    return out;
  }

  private dedupe(items: ExtractedContract[]): ExtractedContract[] {
    const seen = new Set<string>();
    const out: ExtractedContract[] = [];
    for (const c of items) {
      const k = `${c.contractId}|${c.role}|${c.symbolRef.filePath}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  }
}
