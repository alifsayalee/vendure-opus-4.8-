/**
 * @description
 * PayPal subscription status values (mirrored from PayPal onto the local
 * {@link PayPalSubscription} entity).
 */
export type PayPalSubscriptionStatus =
    | 'APPROVAL_PENDING'
    | 'APPROVED'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'CANCELLED'
    | 'EXPIRED';

/** Statuses from which no further automated transition is expected. */
export const TERMINAL_SUBSCRIPTION_STATUSES: ReadonlyArray<PayPalSubscriptionStatus> = [
    'CANCELLED',
    'EXPIRED',
];

/** The billing interval unit for a plan. */
export type PayPalIntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/**
 * @description
 * Input for creating a PayPal billing plan (the recurring price + interval).
 * The `productId` must reference a PayPal Catalog Product created beforehand
 * (the SDK does not expose product creation).
 */
export interface CreateBillingPlanInput {
    productId: string;
    name: string;
    description?: string;
    /** The recurring price in integer minor units (e.g. `1000` = $10.00). */
    amountMinorUnits: number;
    currencyCode: string;
    intervalUnit: PayPalIntervalUnit;
    /** How many interval units between charges (e.g. 1 month). */
    intervalCount: number;
    /** Number of charges; `0` (default) means bill indefinitely. */
    totalCycles?: number;
    /** Consecutive payment failures before PayPal suspends the subscription. */
    paymentFailureThreshold?: number;
    /** When true the plan is created in ACTIVE state, otherwise CREATED. */
    activateImmediately?: boolean;
}

/** Result of creating a billing plan. */
export interface CreateBillingPlanResult {
    planId: string;
    status: string;
}

/** Result of creating a subscription. */
export interface CreateSubscriptionResult {
    subscriptionId: string;
    status: string;
    planId?: string;
    approvalUrl?: string;
}

/** Result of reading a subscription. */
export interface GetSubscriptionResult {
    subscriptionId: string;
    status: string;
    planId?: string;
}
