import { Logger, ScheduledTask } from '@vendure/core';

import { loggerCtx } from '../constants';
import { PayPalSubscriptionService } from './paypal-subscription.service';

/**
 * @description
 * Periodically reconciles the status of every non-terminal local
 * {@link PayPalSubscription} with PayPal. Because PayPal drives the recurring
 * charges itself, this keeps the local mirror (and therefore the admin view)
 * up to date with cancellations, suspensions, and expiries that happen on
 * PayPal's side.
 */
export const payPalSubscriptionSyncTask = new ScheduledTask({
    id: 'paypal-subscription-sync',
    description: 'Reconciles local PayPal subscription statuses with PayPal',
    schedule: cron => cron.every(1).hours(),
    execute: async ({ injector, scheduledContext }) => {
        const service = injector.get(PayPalSubscriptionService);
        const synced = await service.syncAllActive(scheduledContext);
        Logger.info(`PayPal subscription status sync complete (${synced} synced)`, loggerCtx);
        return { synced };
    },
});
