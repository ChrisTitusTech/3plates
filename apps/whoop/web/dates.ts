export const today = (date = new Date()) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
export const ago = (days: number, end = today()) =>
  new Date(Date.parse(end) - days * 86400000).toISOString().slice(0, 10);
