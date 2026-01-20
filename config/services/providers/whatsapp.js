export async function sendWhatsapp({ to, message }) {
  if (!to) throw new Error('Missing "to"');
  // mock success
  return { status: 200, data: { mock: true, to, message } };
}
