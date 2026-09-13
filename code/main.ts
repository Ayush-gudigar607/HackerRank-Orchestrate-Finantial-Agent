import { readCSV } from "./data-loader";

const DATASET_DIR = "./dataset";

async function main() {
  const requests = await readCSV(
    `${DATASET_DIR}/requests.csv`
  );

  const profiles = await readCSV(
    `${DATASET_DIR}/financial_profiles.csv`
  );

  const events = await readCSV(
    `${DATASET_DIR}/financial_events.csv`
  );

  const paymentOptions = await readCSV(
    `${DATASET_DIR}/request_payment_options.csv`
  );

  const messages = await readCSV(
    `${DATASET_DIR}/messages.csv`
  );

  const images = await readCSV(
    `${DATASET_DIR}/images.csv`
  );

  const exchangeRates = await readCSV(
    `${DATASET_DIR}/exchange_rates.csv`
  );

  console.log("Dataset loaded successfully");

  console.log("Requests:", requests.length);
  console.log("Profiles:", profiles.length);
  console.log("Events:", events.length);
  console.log("Payment options:", paymentOptions.length);
  console.log("Messages:", messages.length);
  console.log("Images:", images.length);
  console.log("Exchange rates:", exchangeRates.length);
}

main().catch(error => {
  console.error("Application failed:", error);
  process.exit(1);
});
