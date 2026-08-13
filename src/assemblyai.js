const axios = require('axios');
const FormData = require('form-data');

async function transcribeAudio(audioBuffer, mimeType) {
  try {
    console.log('Starting AssemblyAI transcription...');
    console.log('Audio buffer size:', audioBuffer.length, 'bytes');

    // Step 1: Upload audio file to AssemblyAI
    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      audioBuffer,
      {
        headers: {
          authorization: process.env.ASSEMBLYAI_API_KEY,
          'content-type': 'application/octet-stream',
          'transfer-encoding': 'chunked',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );

    const uploadUrl = uploadResponse.data.upload_url;
    console.log('Audio uploaded to AssemblyAI:', uploadUrl);

    // Step 2: Request transcription
    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      {
        audio_url: uploadUrl,
        language_detection: true,
        punctuate: true,
        format_text: true,
      },
      {
        headers: {
          authorization: process.env.ASSEMBLYAI_API_KEY,
          'content-type': 'application/json',
        },
      },
    );

    const transcriptId = transcriptResponse.data.id;
    console.log('Transcription requested, ID:', transcriptId);

    // Step 3: Poll for completion (max 60 seconds)
    let transcript = null;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pollResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: {
            authorization: process.env.ASSEMBLYAI_API_KEY,
          },
        },
      );

      const status = pollResponse.data.status;
      console.log(`Transcription status (attempt ${attempts + 1}):`, status);

      if (status === 'completed') {
        transcript = pollResponse.data.text;
        console.log('Transcription completed:', transcript);
        break;
      } else if (status === 'error') {
        console.error(
          'AssemblyAI transcription error:',
          pollResponse.data.error,
        );
        return null;
      }

      attempts++;
    }

    if (!transcript) {
      console.error(
        'Transcription timed out after',
        maxAttempts * 2,
        'seconds',
      );
      return null;
    }

    return transcript;
  } catch (error) {
    console.error('transcribeAudio error:', error.message);
    if (error.response) {
      console.error(
        'AssemblyAI response:',
        JSON.stringify(error.response.data, null, 2),
      );
    }
    return null;
  }
}

module.exports = { transcribeAudio };
