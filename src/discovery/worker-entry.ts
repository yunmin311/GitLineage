import { parentPort, workerData } from 'node:worker_threads';
import { compareSnapshots } from './similarity.ts';
parentPort!.postMessage(compareSnapshots(workerData.first,workerData.second));
