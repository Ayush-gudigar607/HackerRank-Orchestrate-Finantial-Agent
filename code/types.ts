/**Define TypeScript interfaces for requests, profiles, events, payment options, messages, etc. */

export interface Request {
  request_id: string;
  user_id: string;
  request_date: string;
  request_type: string;
  requested_amount: number;
  desired_completion_date: string;
  allows_partial_payment: boolean;
  request_text: string;
}

export interface FinancialProfile {
  user_id: string;
  currency: string;
  current_balance: number;
  minimum_balance_to_keep: number;
  priorities: string;
  spending_preferences: string;
  payment_methods_user_will_consider: string;
}

export interface FinancialEvent {
  event_id: string;
  user_id: string;
  event_date: string;
  event_type: string;
  amount: number | null;
  currency: string;
  status: string;
  linked_event_id: string;
}

export interface PaymentOption {
  payment_option_id: string;
  request_id: string;
  payment_method: string;
  start_date: string;
  recurring_interval: string;
  fee: number;
  total_payable: number;
}