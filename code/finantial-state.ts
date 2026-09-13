/**Combine all information for one user/request. */

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

export interface FinancialState {
  request: Request;
  profile: FinancialProfile;
  events: FinancialEvent[];
  paymentOptions: PaymentOption[];
  messages: Message[];
  images: ImageRecord[];
  exchangeRates: ExchangeRate[];
}

export function buildFinancialState(
  dataset: Dataset,
  request: Request,
): FinancialState {
  const profile = dataset.profiles.find(
    (profile) => profile.user_id === request.user_id,
  );

  if (!profile) {
    throw new Error(
      `Financial profile not found for user ${request.user_id}`,
    );
  }

  const events = dataset.events.filter(
    (event) => event.user_id === request.user_id,
  );

  if(!events.length) {
    throw new Error(
      `No financial events found for user ${request.user_id}`,
    );
  }

  const paymentOptions = dataset.paymentOptions.filter(
    (option) => option.request_id === request.request_id,
  );

  if(!paymentOptions.length) {
    throw new Error(
      `No payment options found for request ${request.request_id}`,
    );
  }

  const messages = dataset.messages.filter(
    (message) =>
      message.user_id === request.user_id &&
      (
        message.request_id === request.request_id ||
        message.request_id === "" ||
        events.some(
          (event) =>
            event.event_id === message.related_event_id,
        )
      ),
  );

  if(!messages.length) {
    throw new Error(
      `No messages found for request ${request.request_id}`,
    );
  }

  const images = dataset.images.filter(
    (image) =>
      image.user_id === request.user_id &&
      (
        image.request_id === request.request_id ||
        image.request_id === "" ||
        events.some(
          (event) =>
            event.event_id === image.related_event_id,
        )
      ),
  );

  if(!images.length) {
    throw new Error(
      `No images found for request ${request.request_id}`,
    );
  }

  return {
    request,
    profile,
    events,
    paymentOptions,
    messages,
    images,
    exchangeRates: dataset.exchangeRates,
  };
}

export function getEventById(
  state: FinancialState,
  eventId: string,
): FinancialEvent | undefined {
  return state.events.find(
    (event) => event.event_id === eventId,
  );
}

export function getImageForEvent(
  state: FinancialState,
  eventId: string,
): ImageRecord | undefined {
  return state.images.find(
    (image) => image.related_event_id === eventId,
  );
}

