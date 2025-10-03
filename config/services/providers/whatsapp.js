export async function sendWhatsapp({ to, message }) {
  if (!to) throw new Error('Missing "to"');
  // mock de éxito
  return { status: 200, data: { mock: true, to, message } };
}
