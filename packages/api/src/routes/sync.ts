import { Router } from 'express';
import {
  getPipelines,
  getPipeline,
  getInstances,
  getInstance,
  getExecutions,
  getExecution,
  getSystemOverview,
  getClients,
  triggerSync,
  generateMockData,
} from '../services/syncStore.js';

const router = Router();

// ===== System Overview (for support/engineering) =====

// Get system-wide sync overview
router.get('/overview', (_req, res) => {
  const overview = getSystemOverview();
  res.json({ overview });
});

// ===== Pipelines =====

// Get all sync pipelines
router.get('/pipelines', (_req, res) => {
  const pipelines = getPipelines();
  res.json({ pipelines });
});

// Get specific pipeline
router.get('/pipelines/:id', (req, res) => {
  const pipeline = getPipeline(req.params.id);
  if (!pipeline) {
    return res.status(404).json({ error: 'Pipeline not found' });
  }
  res.json({ pipeline });
});

// ===== Clients =====

// Get all clients
router.get('/clients', (_req, res) => {
  const clients = getClients();
  res.json({ clients });
});

// Get instances for a specific client
router.get('/clients/:clientId/instances', (req, res) => {
  const instances = getInstances({ clientId: req.params.clientId });
  res.json({ instances });
});

// ===== Instances =====

// Get all instances (with optional filters)
router.get('/instances', (req, res) => {
  const { client_id, pipeline_id, status } = req.query;

  const instances = getInstances({
    clientId: client_id as string | undefined,
    pipelineId: pipeline_id as string | undefined,
    status: status as 'healthy' | 'stale' | 'failing' | 'disabled' | undefined,
  });

  res.json({ instances });
});

// Get specific instance
router.get('/instances/:id', (req, res) => {
  const instance = getInstance(req.params.id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  res.json({ instance });
});

// Get executions for an instance
router.get('/instances/:id/executions', (req, res) => {
  const instance = getInstance(req.params.id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const executions = getExecutions({ instanceId: req.params.id, limit });

  res.json({ executions });
});

// Trigger manual sync for an instance
router.post('/instances/:id/sync', (req, res) => {
  const instance = getInstance(req.params.id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const execution = triggerSync(req.params.id);
  if (!execution) {
    return res.status(500).json({ error: 'Failed to trigger sync' });
  }

  res.json({
    message: 'Sync triggered successfully',
    execution,
  });
});

// ===== Executions =====

// Get all executions (with optional filters)
router.get('/executions', (req, res) => {
  const { instance_id, pipeline_id, status, limit } = req.query;

  const executions = getExecutions({
    instanceId: instance_id as string | undefined,
    pipelineId: pipeline_id as string | undefined,
    status: status as 'running' | 'success' | 'partial' | 'failed' | undefined,
    limit: limit ? parseInt(limit as string, 10) : 50,
  });

  res.json({ executions });
});

// Get specific execution
router.get('/executions/:id', (req, res) => {
  const execution = getExecution(req.params.id);
  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }
  res.json({ execution });
});

// ===== Simulation =====

// Generate/reset mock data
router.post('/simulate', (req, res) => {
  const { clientCount = 5, introduceFailures = true } = req.body;

  generateMockData({ clientCount, introduceFailures });

  const overview = getSystemOverview();

  res.json({
    success: true,
    message: 'Mock sync data generated',
    overview: {
      activeClients: overview.activeClients,
      totalPipelines: overview.pipelineStats.length,
      totalInstances: overview.pipelineStats.reduce((sum, p) => sum + p.totalInstances, 0),
      failingInstances: overview.failingInstances,
    },
  });
});

export default router;
