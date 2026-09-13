import { loadDataset } from "./data-loader";

const DATASET_DIR = "./dataset";

async function main() {
  const dataset = await loadDataset(DATASET_DIR);

  console.log("Dataset loaded successfully");

  console.log({
    requests: dataset.requests.length,
    profiles: dataset.profiles.length,
    events: dataset.events.length,
    paymentOptions: dataset.paymentOptions.length,
    messages: dataset.messages.length,
    images: dataset.images.length,
    exchangeRates: dataset.exchangeRates.length,
  });

  console.log("\nFirst request:");
  console.log(dataset.requests[0]);

  console.log("\nFirst profile:");
  console.log(dataset.profiles[0]);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});