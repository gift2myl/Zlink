(() => {
  'use strict';
  const text = document.getElementById('detail-inquiry-text');
  const button = document.getElementById('detail-copy');
  const status = document.getElementById('detail-copy-status');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('无法自动复制');
      await navigator.clipboard.writeText(text.value);
      status.textContent = '已复制，可连同门锁照片发给您的服务人员。';
    } catch {
      status.textContent = '自动复制未完成，请长按或选中上方文字，手动复制。';
      text.focus(); text.select();
    } finally {
      button.disabled = false;
    }
  });
})();
