document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', isOpen);
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => navLinks.classList.remove('open'));
  });

  const form = document.getElementById('contact');
  const status = document.querySelector('.form-status');

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const name = formData.get('name');
    status.textContent = `Спасибо, ${name || 'коллеги'}! Мы свяжемся с вами в течение дня.`;
    status.style.color = 'var(--accent)';
    form.reset();
  });
});
