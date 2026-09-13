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