const nodemailer = require('nodemailer');
const validator = require('validator');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false, // true für 465, false für 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production' // Für Hetzner in Produktion sicher
  }
});

// Sicherheits-Funktion: Email-Adressen validieren
function validateEmailAddress(email) {
  if (!email || typeof email !== 'string') {
    throw new Error('Ungültige Email-Adresse');
  }
  
  const cleanEmail = validator.normalizeEmail(email);
  if (!validator.isEmail(cleanEmail)) {
    throw new Error('Email-Format ungültig');
  }
  
  return cleanEmail;
}

// Sicherheits-Funktion: HTML-Eingaben bereinigen
function sanitizeForEmail(input) {
  if (!input) return '';
  return validator.escape(String(input));
}

// TEST-FUNKTION: Verbindung prüfen
async function testEmailConnection() {
  try {
    await transporter.verify();
    console.log('Email-Server-Verbindung erfolgreich');
    return true;
  } catch (error) {
    console.error('Email-Server-Verbindung fehlgeschlagen:', error.message);
    return false;
  }
}

// NEUE FUNKTION: Benachrichtigung bei neuer Anfrage (mit Validierung)
async function sendAnfrageNotification(anfrage) {
  console.log('Erstelle Benachrichtigungs-Email für Anfrage ID:', anfrage.id);
  
  if (!process.env.INTERNAL_NOTIFICATION_EMAIL) {
    throw new Error('INTERNAL_NOTIFICATION_EMAIL nicht in Umgebungsvariablen definiert');
  }

  // Email-Adressen validieren
  const toEmail = validateEmailAddress(process.env.INTERNAL_NOTIFICATION_EMAIL);
  const fromEmail = validateEmailAddress(process.env.EMAIL_USER);

  // Verbindung vor dem Senden testen
  const connectionOk = await testEmailConnection();
  if (!connectionOk) {
    throw new Error('Email-Server-Verbindung fehlgeschlagen');
  }
  
  const { kontakt, problem, beschreibung, istTelefonanfrage, termine } = anfrage;
  
  // Eingaben bereinigen
  const safeKontakt = {
    vorname: sanitizeForEmail(kontakt.vorname),
    nachname: sanitizeForEmail(kontakt.nachname),
    email: sanitizeForEmail(kontakt.email),
    telefon: sanitizeForEmail(kontakt.telefon),
    adresse: sanitizeForEmail(kontakt.adresse),
    plz: sanitizeForEmail(kontakt.plz),
    ort: sanitizeForEmail(kontakt.ort),
    kundennummer: sanitizeForEmail(kontakt.kundennummer || ''),
    firma: sanitizeForEmail(kontakt.firma || '')
  };
  
  const safeBeschreibung = sanitizeForEmail(beschreibung);
  
  const problemText = Object.entries(problem?.toObject ? problem.toObject() : (problem || {}))
    .filter(([key]) => key !== '_id')
    .map(([key, value]) => `${sanitizeForEmail(key)}: ${sanitizeForEmail(value)}`)
    .join(', ');

  const termineText = istTelefonanfrage ? 
    'Telefonanfrage - keine Termine' : 
    termine.map(t => {
      const start = new Date(t.start);
      const end = new Date(t.end);
      return `${start.toLocaleDateString('de-DE')} von ${start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} bis ${end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    }).join('\n');

  const mailOptions = {
    from: fromEmail,
    to: toEmail,
    subject: `Neue ${istTelefonanfrage ? 'Telefonanfrage' : 'Vor-Ort-Anfrage'} von ${safeKontakt.vorname} ${safeKontakt.nachname}`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 650px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 25px; color: #111827;">
        
        <!-- Header -->
        <div style="text-align: center; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px;">
          <h2 style="color: #1e3a8a; margin: 0; font-size: 22px;">Neue Anfrage eingegangen</h2>
          <p style="color: #4b5563; font-size: 14px; margin: 5px 0;">
            Es liegt eine neue ${istTelefonanfrage ? 'Telefonanfrage' : 'Vor-Ort-Anfrage'} von 
            <strong>${safeKontakt.vorname} ${safeKontakt.nachname}</strong> vor.
          </p>
        </div>

        <!-- Kundendaten -->
        <div style="background-color: #f9fafb; padding: 18px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px; color: #1f2937; font-size: 16px;">Kundendaten</h3>
          <p style="margin: 5px 0;"><strong>Name:</strong> ${safeKontakt.vorname} ${safeKontakt.nachname}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${safeKontakt.email}</p>
          <p style="margin: 5px 0;"><strong>Telefon:</strong> ${safeKontakt.telefon}</p>
          <p style="margin: 5px 0;"><strong>Adresse:</strong> ${safeKontakt.adresse}, ${safeKontakt.plz} ${safeKontakt.ort}</p>
          ${safeKontakt.kundennummer ? `<p style="margin: 5px 0;"><strong>Kundennummer:</strong> ${safeKontakt.kundennummer}</p>` : ''}
          ${safeKontakt.firma ? `<p style="margin: 5px 0;"><strong>Firma:</strong> ${safeKontakt.firma}</p>` : ''}
        </div>

        <!-- Problem -->
        <div style="background-color: #fff7ed; padding: 18px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px; color: #92400e; font-size: 16px;">Problem</h3>
          <p style="margin: 5px 0;"><strong>Art:</strong> ${istTelefonanfrage ? 'Telefonanfrage' : 'Vor-Ort-Termin'}</p>
          <p style="margin: 5px 0;"><strong>Details:</strong> ${problemText}</p>
          <p style="margin: 5px 0;"><strong>Beschreibung:</strong></p>
          <div style="background: #ffffff; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; line-height: 1.4;">
            ${safeBeschreibung}
          </div>
        </div>

        <!-- Terminwünsche -->
        <div style="background-color: #e0f2fe; padding: 18px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px; color: #1e40af; font-size: 16px;">Terminwünsche</h3>
          <pre style="background: #ffffff; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 13px; border: 1px solid #d1d5db; white-space: pre-wrap;">
${termineText}
          </pre>
        </div>

        <!-- Hinweis -->
        <div style="background-color: #fee2e2; padding: 15px; border-radius: 8px; text-align: center; margin-top: 20px;">
          <strong style="color: #991b1b; font-size: 14px;">Bitte im Admin-Dashboard prüfen und weiterverarbeiten!</strong>
        </div>
      </div>
    `
  };

  const result = await transporter.sendMail(mailOptions);
  console.log('Benachrichtigungs-Email erfolgreich gesendet. Message ID:', result.messageId);
  return result;
}

async function sendTerminBestaetigung(anfrage, terminSlot, bemerkung) {
  console.log('Sende Terminbestätigung für Anfrage ID:', anfrage.id);
  
  const { kontakt } = anfrage;
  
  // Email validieren
  const cleanEmail = validateEmailAddress(kontakt.email);
  
  const start = new Date(terminSlot.start);
  const end = new Date(terminSlot.end);
  
  const datum = start.toLocaleDateString('de-DE', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const zeitspanne = `${start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

  // Eingaben bereinigen
  const safeKontakt = {
    vorname: sanitizeForEmail(kontakt.vorname),
    nachname: sanitizeForEmail(kontakt.nachname),
    adresse: sanitizeForEmail(kontakt.adresse),
    plz: sanitizeForEmail(kontakt.plz),
    ort: sanitizeForEmail(kontakt.ort)
  };
  const safeBemerkung = sanitizeForEmail(bemerkung || '');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: cleanEmail,
    subject: 'Terminbestätigung - Ihr Service-Termin',
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; color: #333; border: 1px solid #e5e7eb; border-radius: 8px; padding: 25px;">

        <!-- Header -->
        <div style="text-align: center; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px;">
          <h2 style="color: #1e3a8a; margin: 0; font-size: 22px;">Terminbestätigung</h2>
          <p style="color: #4b5563; font-size: 14px; margin: 5px 0;">Ihr Service-Termin wurde erfolgreich bestätigt</p>
        </div>

        <!-- Persönliche Anrede -->
        <p style="font-size: 15px; color: #374151; margin-bottom: 20px;">
          Sehr geehrte/r Frau/Herr ${safeKontakt.nachname},
        </p>

        <!-- Bestätigung -->
        <div style="background-color: #e0f2fe; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px; color: #0369a1;">Termindetails</h3>
          <p style="margin: 5px 0;"><strong>Datum:</strong> ${datum}</p>
          <p style="margin: 5px 0;"><strong>Zeitfenster:</strong> ${zeitspanne}</p>
        </div>

        <!-- Adresse -->
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 10px; color: #1e3a8a;">Adresse</h4>
          <p style="margin: 5px 0;">${safeKontakt.adresse}<br>${safeKontakt.plz} ${safeKontakt.ort}</p>
        </div>

        <!-- Hinweise, falls vorhanden -->
        ${safeBemerkung ? `
        <div style="background-color: #fff7ed; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 10px; color: #b45309;">Hinweise</h4>
          <p style="margin: 5px 0;">${safeBemerkung}</p>
        </div>
        ` : ''}

        <!-- Wichtige Info -->
        <div style="background-color: #fef2f2; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
          <p style="margin: 0; color: #991b1b; font-size: 14px;">
             <strong>Wichtig:</strong> Bitte halten Sie sich während des angegebenen Zeitfensters bereit. Unser Techniker wird Sie kurz vor der Ankunft kontaktieren.  
               Stellen Sie bitte außerdem sicher, dass alle zu bearbeitenden Objekte wie z. B. Vasen, Dekorationen oder andere Gegenstände weggeräumt sind und insbesondere die Fensterbänke sowie der Arbeitsbereich frei zugänglich sind.
          </p>
        </div>

        <!-- Grüße -->
        <p style="margin: 0; font-size: 15px; color: #374151; margin-bottom: 25px;">
          Mit freundlichen Grüßen,<br>
          <strong>Ihr Service-Team</strong>
        </p>

        <!-- Footer -->
        <hr style="margin: 25px 0; border: none; border-top: 1px solid #e5e7eb;">
        <div style="font-size: 12px; color: #6b7280; line-height: 1.5;">
          <p style="margin: 5px 0;">
            Dies ist eine automatisch generierte E-Mail. Bitte antworten Sie nicht direkt auf diese Nachricht.
          </p>
          <p style="margin: 5px 0;">
            <strong>Impressum:</strong><br>
            Metallbau Jünemann<br>
            Matthias Jünemann<br>
            Freiheitstraße 44<br>
            41812 Erkelenz<br>
            Telefon: 02431 / 123456<br>
            E-Mail: info@metallbau-juenemann.de<br>
          </p>
        </div>
      </div>
    `
  };

  const result = await transporter.sendMail(mailOptions);
  console.log('Terminbestätigungs-Email erfolgreich gesendet. Message ID:', result.messageId);
  return result;
}

async function sendTerminAbsage(anfrage, bemerkung) {
  const { kontakt } = anfrage;

  // Email validieren
  const cleanEmail = validateEmailAddress(kontakt.email);
  
  // Eingaben bereinigen
  const safeKontakt = {
    vorname: sanitizeForEmail(kontakt.vorname),
    nachname: sanitizeForEmail(kontakt.nachname)
  };
  const safeBemerkung = sanitizeForEmail(bemerkung || '');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: cleanEmail,
    subject: 'Terminabsage - Ihr Service-Termin',
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; color: #333; border: 1px solid #e5e7eb; border-radius: 8px; padding: 25px;">

        <!-- Header -->
        <div style="text-align: center; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px;">
          <h2 style="color: #dc2626; margin: 0; font-size: 22px;">Terminabsage</h2>
          <p style="color: #4b5563; font-size: 14px; margin: 5px 0;">Leider können wir Ihren Wunschtermin nicht bestätigen</p>
        </div>

        <!-- Begrüßung -->
        <p style="margin: 0 0 15px; font-size: 15px; color: #111827;">
          Sehr geehrte/r ${safeKontakt.vorname} ${safeKontakt.nachname},
        </p>

        <!-- Absage-Info -->
        <div style="background-color: #fee2e2; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="margin: 0 0 8px; color: #991b1b; font-size: 15px;">
            Leider müssen wir Ihnen mitteilen, dass wir Ihre Anfrage für den gewünschten Termin aktuell nicht berücksichtigen können.
          </p>
          ${safeBemerkung ? `<p style="margin: 0; color: #991b1b; font-size: 14px;"><strong>Grund:</strong> ${safeBemerkung}</p>` : ''}
        </div>

        <!-- Erneute Anfrage -->
        <div style="background-color: #e0f2fe; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 14px; color: #0369a1;">
            Wir möchten Ihnen jedoch anbieten, es gerne noch einmal mit einer neuen Terminanfrage zu versuchen.
            Manchmal sind kurzfristig wieder Slots verfügbar, die wir Ihnen dann gerne einrichten.
          </p>
        </div>

        <!-- Grüße -->
        <p style="margin: 20px 0 0; font-size: 15px; color: #374151;">
          Mit freundlichen Grüßen,<br>
          <strong>Ihr Service-Team</strong>
        </p>

        <!-- Footer -->
        <hr style="margin: 25px 0; border: none; border-top: 1px solid #e5e7eb;">
        <div style="font-size: 12px; color: #6b7280; line-height: 1.5;">
          <p style="margin: 5px 0;">
            Dies ist eine automatisch generierte E-Mail.
          </p>
          <p style="margin: 5px 0;">
            <strong>Impressum:</strong><br>
            Metallbau Jünemann<br>
            Matthias Jünemann<br>
            Freiheitstraße 44<br>
            41812 Erkelenz<br>
            Telefon: +49 1523 / 8914307<br>
            E-Mail: info@metallbau-juenemann.de<br>
          </p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  sendTerminBestaetigung,
  sendTerminAbsage,
  sendAnfrageNotification,
  testEmailConnection
};