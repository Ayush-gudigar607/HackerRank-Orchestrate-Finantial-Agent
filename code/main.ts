import { loadDataset } from "./data-loader";
import  {buildFinancialState} from "./finantial-state";

const DATASET_DIR = "./dataset";

async function main() {
  const dataset = await loadDataset(DATASET_DIR);

  const request = dataset.requests[0];

  if (!request) {
    throw new Error("No requests found in the dataset");
  }

  const state= buildFinancialState(dataset, request);

  if (!state) {
    throw new Error(`Failed to build financial state for request ${request.request_id}`);
  }


   console.log("Request:", state.request.request_id);
  console.log("User:", state.request.user_id);
  console.log("Balance:", state.profile.current_balance);
  console.log("Minimum balance:", state.profile.minimum_balance_to_keep);

  console.log("Events:", state.events.length);
  console.log("Payment options:", state.paymentOptions.length);
  console.log("Messages:", state.messages.length);
  console.log("Images:", state.images.length);
}

main().catch(console.error);