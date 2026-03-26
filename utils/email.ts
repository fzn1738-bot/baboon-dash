export const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, html }),
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to send email');
    }
    return data;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};
