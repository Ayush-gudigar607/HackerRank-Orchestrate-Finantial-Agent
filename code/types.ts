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
  expense_categories_to_protect: string;
  expense_categories_user_is_willing_to_reduce: string;
  expense_categories_user_is_willing_to_stop: string;
  payment_methods_user_will_consider: string;
  max_installment_months: number | null;
}

export interface FinancialEvent {
  event_id: string;
  user_id: string;
  event_type: string;
  description: string;
  category: string;
  direction: string;
  amount: number | null;
  currency: string;
  event_date: string;
  settlement_date: string;
  status: string;
  linked_event_id: string;
  flexibility: string;
  minimum_allowed_amount: number | null;
}

export interface PaymentOption {
  payment_option_id: string;
  request_id: string;
  payment_method: string;
  payment_amount: number;
  number_of_payments: number;
  first_payment_date: string;
  payment_frequency_days: number | null;
  fee: number;
  total_payable: number;
}

export interface Message {
  message_id: string;
  user_id: string;
  request_id: string;
  related_event_id: string;
  sent_at: string;
  source_type: string;
  message_text: string;
}

export interface ImageRecord {
  image_id: string;
  user_id: string;
  request_id: string;
  related_event_id: string;
}

export interface ExchangeRate {
  rate_date: string;
  from_currency: string;
  to_currency: string;
  rate: number;
}

export interface Dataset {
  requests: Request[];
  profiles: FinancialProfile[];
  events: FinancialEvent[];
  paymentOptions: PaymentOption[];
  messages: Message[];
  images: ImageRecord[];
  exchangeRates: ExchangeRate[];
}