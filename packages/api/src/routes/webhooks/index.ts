import { Router } from 'express';
import procoreRoutes from './procore.js';
import gustoRoutes from './gusto.js';
import quickbooksRoutes from './quickbooks.js';
import stripeRoutes from './stripe.js';
import certifiedPayrollRoutes from './certified-payroll.js';

const router = Router();

router.use('/procore', procoreRoutes);
router.use('/gusto', gustoRoutes);
router.use('/quickbooks', quickbooksRoutes);
router.use('/stripe', stripeRoutes);
router.use('/certified-payroll', certifiedPayrollRoutes);

export default router;
