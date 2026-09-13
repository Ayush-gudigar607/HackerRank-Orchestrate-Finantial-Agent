import { loadDataset } from "./code/data-loader";

const dataset = await loadDataset("./dataset");

const blank = dataset.events.filter(
  (event) => event.amount === null,
);

console.log("Blank event amounts:", blank.length);

for (const event of blank.slice(0, 10)) {
  const image = dataset.images.find(
    (image) => image.related_event_id === event.event_id,
  );

  console.log({
    event_id: event.event_id,
    event_type: event.event_type,
    image_id: image?.image_id ?? "NO IMAGE",
  });
}