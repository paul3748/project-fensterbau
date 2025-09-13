// Debug: Zeige an dass das externe Script geladen wurde
console.log('🔧 login.js FILE GELADEN');

document.addEventListener('DOMContentLoaded', () => {
  console.log('🔧 DOM Content Loaded - login.js startet');
  
  const form = document.getElementById('loginForm');
  if (!form) {
    console.error('❌ Login Formular nicht gefunden');
    return;
  }

  // Debug-Info in die Seite schreiben
  const debugElement = document.getElementById('status');
  if (debugElement) {
    debugElement.innerHTML = 'Inline JS: ✅ | Externes JS: ✅ | Form gefunden: ✅';
  }

  // Markiere das Form als "JS geladen"
  form.setAttribute('data-js-loaded', 'true');

  console.log('✅ login.js gestartet - Form-Handler wird installiert');

  // CSRF Token holen
  fetch('/csrf-token', { credentials: 'include' })
    .then(res => res.json())
    .then(data => {
      document.getElementById('csrfToken').value = data.csrfToken;
      console.log('🔑 CSRF Token gesetzt:', data.csrfToken.substring(0,8)+'...');
    })
    .catch(err => console.error('CSRF Fehler:', err));

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // Verhindert normale Form-Submission
    console.log('🔄 Login Formular abgesendet');

    // Button deaktivieren um mehrfaches Absenden zu verhindern
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Wird verarbeitet...';
    }

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    console.log('📤 Sende Daten:', { ...data, password: '[HIDDEN]' });

    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(data),
        credentials: 'include'
      });

      console.log('📥 Response Status:', res.status, res.statusText);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const result = await res.json();
      console.log('🔹 Login Response:', result);

      if (result.success) {
        console.log('✅ Login erfolgreich, leite weiter zu:', result.redirect || '/admin');
        // Sofortige Weiterleitung
        window.location.replace(result.redirect || '/admin');
      } else {
        console.error('❌ Login fehlgeschlagen:', result.message);
        alert(result.message || 'Login fehlgeschlagen');
        
        // Button wieder aktivieren
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Anmelden';
        }
      }
    } catch (err) {
      console.error('❌ Login Fehler:', err);
      alert('Fehler beim Login. Bitte versuchen Sie es erneut.');
      
      // Button wieder aktivieren
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Anmelden';
      }
    }
  });
});