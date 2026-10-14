export default async function run(page, ui) {
  const s = await ui.snapshot();
  return s
    .split("\n")
    .filter((l) => /Pipe|Duct|Select|Fluid/i.test(l))
    .slice(0, 20)
    .join("\n");
}
