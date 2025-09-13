const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const host = 'j5h7.your-database.de';
const port = 5432;

console.log('Verbinde zu PostgreSQL Server mit SSL-Upgrade...');

// PostgreSQL SSL-Request Message (8 bytes)
const sslRequestMessage = Buffer.alloc(8);
sslRequestMessage.writeInt32BE(8, 0);      // Länge
sslRequestMessage.writeInt32BE(80877103, 4); // SSL-Request Code

const socket = new net.Socket();

socket.connect(port, host, () => {
  console.log('TCP Verbindung hergestellt, sende SSL-Request...');
  socket.write(sslRequestMessage);
});

socket.on('data', (data) => {
  if (data.length === 1) {
    const response = data[0];
    
    if (response === 83) { // 'S' - SSL unterstützt
      console.log('Server unterstützt SSL, starte TLS-Upgrade...');
      
      const tlsSocket = tls.connect({
        socket: socket,
        servername: host,
        rejectUnauthorized: false // Für Debugging
      });
      
      tlsSocket.on('secureConnect', () => {
        console.log('✅ TLS Verbindung erfolgreich!');
        
        const cert = tlsSocket.getPeerCertificate(true);
        console.log('\n📋 Server Zertifikat Info:');
        console.log('Subject:', cert.subject);
        console.log('Issuer:', cert.issuer);
        console.log('Valid from:', cert.valid_from);
        console.log('Valid to:', cert.valid_to);
        console.log('Fingerprint:', cert.fingerprint);
        
        // Erstelle certs Ordner
        const certDir = path.join(__dirname, '..', 'certs');
        if (!fs.existsSync(certDir)) {
          fs.mkdirSync(certDir, { recursive: true });
          console.log('📁 Certs-Ordner erstellt');
        }
        
        // Server-Zertifikat speichern
        const serverCert = '-----BEGIN CERTIFICATE-----\n' + 
          cert.raw.toString('base64').match(/.{1,64}/g).join('\n') + 
          '\n-----END CERTIFICATE-----\n';
        
        const serverCertPath = path.join(certDir, 'postgresql-server.pem');
        fs.writeFileSync(serverCertPath, serverCert);
        console.log('💾 Server-Zertifikat gespeichert in:', serverCertPath);
        
        // Zertifikatskette speichern wenn vorhanden
        if (cert.issuerCertificate && cert.issuerCertificate !== cert) {
          console.log('🔗 Intermediate-Zertifikat gefunden...');
          
          let intermediateCerts = '';
          let currentCert = cert.issuerCertificate;
          let chainLength = 0;
          
          while (currentCert && currentCert !== cert && chainLength < 10) {
            intermediateCerts += '-----BEGIN CERTIFICATE-----\n' + 
              currentCert.raw.toString('base64').match(/.{1,64}/g).join('\n') + 
              '\n-----END CERTIFICATE-----\n';
            
            chainLength++;
            currentCert = currentCert.issuerCertificate;
            if (currentCert === cert.issuerCertificate) break; // Endlosschleife vermeiden
          }
          
          if (intermediateCerts) {
            const chainPath = path.join(certDir, 'postgresql-chain.pem');
            fs.writeFileSync(chainPath, intermediateCerts);
            console.log('🔗 Zertifikatskette gespeichert in:', chainPath);
            
            // Vollständige Kette (Server + Intermediate)
            const fullChainPath = path.join(certDir, 'postgresql-fullchain.pem');
            fs.writeFileSync(fullChainPath, serverCert + intermediateCerts);
            console.log('📜 Vollständige Kette gespeichert in:', fullChainPath);
          }
        }
        
        console.log('\n🎯 Nächste Schritte:');
        console.log('1. Verwende postgresql-fullchain.pem (falls vorhanden) oder postgresql-server.pem');
        console.log('2. Aktualisiere deine database.js Konfiguration');
        
        tlsSocket.end();
      });
      
      tlsSocket.on('error', (error) => {
        console.error('❌ TLS Fehler:', error.message);
        socket.destroy();
      });
      
    } else if (response === 78) { // 'N' - SSL nicht unterstützt
      console.log('❌ Server unterstützt kein SSL');
      socket.destroy();
    } else {
      console.log('❓ Unbekannte Antwort vom Server:', response);
      socket.destroy();
    }
  }
});

socket.on('error', (error) => {
  console.error('❌ Verbindungsfehler:', error.message);
});

socket.on('close', () => {
  console.log('🔌 Verbindung geschlossen');
});