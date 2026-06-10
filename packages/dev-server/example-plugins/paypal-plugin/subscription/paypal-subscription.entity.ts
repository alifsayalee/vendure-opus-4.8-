import { DeepPartial, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { PayPalSubscriptionStatus } from './subscription-types';

/**
 * @description
 * A local record of a PayPal subscription created through Vendure. Stored so
 * the merchant can list subscriptions, link them to a Vendure customer, and
 * drive cancellation / status sync without depending on a live PayPal lookup.
 */
@Entity()
export class PayPalSubscription extends VendureEntity {
    constructor(input?: DeepPartial<PayPalSubscription>) {
        super(input);
    }

    /** The PayPal-generated subscription id. */
    @Index({ unique: true })
    @Column()
    paypalSubscriptionId: string;

    /** The PayPal billing plan id this subscription is based on. */
    @Column()
    planId: string;

    /** The last known PayPal status, mirrored locally. */
    @Column()
    status: PayPalSubscriptionStatus;

    /** The Vendure customer this subscription belongs to, if known. */
    @Column({ type: 'varchar', nullable: true })
    customerId: ID | null;

    /** The buyer approval URL returned at creation (valid until approved). */
    @Column({ type: 'text', nullable: true })
    approvalUrl: string | null;

    /** When the local status was last reconciled with PayPal. */
    @Column({ type: Date, nullable: true })
    lastSyncedAt: Date | null;
}
