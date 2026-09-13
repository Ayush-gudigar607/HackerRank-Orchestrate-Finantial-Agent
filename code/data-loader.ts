/**Read all csv files correctly */
import { readFile } from "node:fs/promises";
import type {
  Dataset,
  Request,
  FinancialProfile,
  FinancialEvent,
  PaymentOption,
  Message,
  ImageRecord,
  ExchangeRate,
} from "./types";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result.map((value) => value.trim().replace(/^"|"$/g, ""));
}

//this will retuen the row
async function readCSV(path: string): Promise<Record<string, string>[]> {
  const content = await readFile(path, "utf-8");

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCSVLine(lines[0]!);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);

    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

function number(value: string): number {
  const result = Number(value);

  if (Number.isNaN(result)) {
    throw new Error(`Invalid number: "${value}"`);
  }

  return result;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }

  return number(value);
}

function boolean(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

export async function loadDataset(datasetDir: string): Promise<Dataset> {
    const [
    rawRequests,
    rawProfiles,
    rawEvents,
    rawPaymentOptions,
    rawMessages,
    rawImages,
    rawExchangeRates,
  ] = await Promise.all([
    readCSV(`${datasetDir}/requests.csv`),
    readCSV(`${datasetDir}/financial_profiles.csv`),
    readCSV(`${datasetDir}/financial_events.csv`),
    readCSV(`${datasetDir}/request_payment_options.csv`),
    readCSV(`${datasetDir}/messages.csv`),
    readCSV(`${datasetDir}/images.csv`),
    readCSV(`${datasetDir}/exchange_rates.csv`),
  ]);

   const requests: Request[] = rawRequests.map(row => ({
    request_id: row.request_id!,
    user_id: row.user_id!,
    request_date: row.request_date!,
    request_type: row.request_type!,
    request_status: row.request_status!,
    requested_amount: number(row.requested_amount!),
    desired_completion_date: row.desired_completion_date!,
    allows_partial_payment: boolean(row.allows_partial_payment!),
    request_text: row.request_text!,
  }));

  const profiles: FinancialProfile[] = rawProfiles.map(row => ({
    user_id: row.user_id!,
    currency: row.home_currency!,
    current_balance: number(row.current_available_balance!),
    minimum_balance_to_keep: number(row.minimum_balance_to_keep!),
    priorities: row.financial_priorities!,
    expense_categories_to_protect: row.expense_categories_to_protect!,
    expense_categories_user_is_willing_to_reduce:
      row.expense_categories_user_is_willing_to_reduce!,
    expense_categories_user_is_willing_to_stop:
      row.expense_categories_user_is_willing_to_stop!,
    payment_methods_user_will_consider:
      row.payment_methods_user_will_consider!,
    max_installment_months: numberOrNull(row.max_installment_months!),
  }));

    const events: FinancialEvent[] = rawEvents.map(row => ({
    event_id: row.event_id!,
    user_id: row.user_id!,
    event_date: row.event_date!,
    event_type: row.event_type!,
    amount: number(row.amount!),
    currency: row.currency!,
    status: row.status!,
    linked_event_id: row.linked_event_id!,
  }));

   const paymentOptions: PaymentOption[] =
    rawPaymentOptions.map(row => ({
      payment_option_id: row.payment_option_id!,
      request_id: row.request_id!,
      payment_method: row.payment_method!,
      start_date: row.start_date!,
      recurring_interval: row.recurring_interval!,
      fee: number(row.financing_fee!),
      total_payable: number(row.total_payable_amount!),
    }));

    const messages: Message[] = rawMessages.map(row => ({
    message_id: row.message_id!,
    user_id: row.user_id!,
    request_id: row.request_id!,
    related_event_id: row.related_event_id!,
    message_date: row.message_date!,
    message_text: row.message_text!,
  }));

  const images: ImageRecord[] = rawImages.map(row => ({
    image_id: row.image_id!,
    user_id: row.user_id!,
    request_id: row.request_id!,
    related_event_id: row.related_event_id!,
    image_path: row.image_path!,
  }));

  const exchangeRates: ExchangeRate[] =
    rawExchangeRates.map(row => ({
      rate_date: row.rate_date!,
      from_currency: row.from_currency!,
      to_currency: row.to_currency!,
      rate: number(row.rate!),
    }));

    return {
    requests,
    profiles,
    events,
    paymentOptions,
    messages,
    images,
    exchangeRates,
  };
}
