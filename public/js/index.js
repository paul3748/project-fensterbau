  // Menü-Toggle für mobile Navigation
  const toggleButton = document.querySelector('.menu-toggle');
  const navMenu = document.querySelector('nav ul');

  toggleButton.addEventListener('click', () => {
    navMenu.classList.toggle('active'); // Menü ein-/ausblenden
    const expanded = navMenu.classList.contains('active');
    toggleButton.setAttribute('aria-expanded', expanded); // Accessibility
  });