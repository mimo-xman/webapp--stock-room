/** Shared UI-side constants (kept in sync with the API's constants.js). */

export const CATEGORIES = [
  "Animals",
  "Buildings and Architecture",
  "Business",
  "Drinks",
  "The Environment",
  "States of Mind",
  "Food",
  "Graphic Resources",
  "Hobbies and Leisure",
  "Industry",
  "Landscapes",
  "Lifestyle",
  "People",
  "Plants and Flowers",
  "Culture and Religion",
  "Science",
  "Social Issues",
  "Sports",
  "Technology",
  "Transport",
  "Travel",
] as const;

export const QUALITIES = ["1K", "2K", "4K"] as const;

export const RATIOS = [
  "Auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "3:1",
  "1:3",
  "21:9",
  "9:21",
] as const;

export const PAGE_SIZES = [5, 10, 20, 50, 100] as const;

export const SESSION_SORTS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "imagesCount", label: "Images" },
] as const;

export const IMAGE_SORTS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "title", label: "Title" },
  { value: "category", label: "Category" },
  { value: "used_in_adobe_stock", label: "Adobe Stock" },
  { value: "quality", label: "Quality" },
  { value: "ratio", label: "Ratio" },
  { value: "prompt", label: "Prompt" },
] as const;
