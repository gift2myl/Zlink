(() => {
  'use strict';
  const products = {
    b0100: {
      price: '768',
      title: '自如高端指纹密码锁',
      fullName: '自如高端指纹密码锁 ZH-B0100',
      purpose: '十年百万自如家庭验证，安全质量保障',
      facts: ['外门指纹锁，作为本页优先推荐的换新选择。', '新换装随附一把机械钥匙。', '提供门体照片，先核对安装适配。'],
      conditions: 'App、联网、账号管理及其他开门方式，请按实际供货版本确认。'
    },
    v5air: {
      price: '1,930',
      title: '鹿客 V5Air',
      fullName: '智能门锁·鹿客·外门·V5Air',
      purpose: '偏好鹿客品牌，换新时可以看看这一款。',
      facts: ['鹿客外门智能锁。', '新换装随附一把机械钥匙。', '核对门体及实际供货版本后，确认适合您的配置。'],
      conditions: '具体开门方式、App、联网及管理条件，请按实际供货版本确认。'
    },
    s6max: {
      price: '1,730',
      title: '鹿客 S6MAX',
      fullName: '智能门锁·鹿客·外门·S6MAX',
      purpose: '自己住，想用指脉、人脸等方式开门。',
      facts: ['三面指脉与结构光 3D 人脸识别。', '天地双摄、4.7 英寸内屏。', '日常开门无需自如 App 或额外网关。', '新换装随附一把机械钥匙。'],
      conditions: '远程视频对讲、远程开门需配置鹿客管家 App 和网络。安装前仍需核对门体适配。'
    }
  };
  const dialog = document.getElementById('product-dialog');
  const inquiry = document.getElementById('inquiry-text');
  const status = document.getElementById('copy-status');
  const copyButton = document.getElementById('copy-inquiry');
  let copyVersion = 0;
  function openProduct(key) {
    const product = products[key];
    if (!product) return;
    copyVersion++;
    document.getElementById('dialog-title').textContent = product.title;
    document.getElementById('dialog-price').textContent = `¥${product.price}`;
    document.getElementById('dialog-purpose').textContent = product.purpose;
    document.getElementById('dialog-conditions').textContent = product.conditions;
    document.getElementById('dialog-facts').replaceChildren(...product.facts.map(text => {
      const li = document.createElement('li'); li.textContent = text; return li;
    }));
    inquiry.value = `您好，我想了解${product.fullName}，自如业主专享价 ¥${product.price}，免费基础安装。\n房子目前用途：自住／出租（请修改）。\n安装地区：请补充。\n我会提供门外、门内和门侧照片，请帮我核对门体适配、使用条件、基础安装范围和可安排时间。`;
    status.textContent = '';
    copyButton.disabled = false;
    dialog.showModal();
  }
  document.querySelectorAll('[data-product]').forEach(button => {
    button.addEventListener('click', () => openProduct(button.dataset.product));
  });
  document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { copyVersion++; });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  copyButton.addEventListener('click', async () => {
    const version = ++copyVersion;
    copyButton.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('无法自动复制');
      await navigator.clipboard.writeText(inquiry.value);
      if (version === copyVersion) status.textContent = '已复制，可发给您的服务人员。';
    } catch {
      if (version === copyVersion) {
        status.textContent = '自动复制未完成，请长按或选中上方文字，手动复制。';
        inquiry.focus(); inquiry.select();
      }
    } finally {
      if (version === copyVersion) copyButton.disabled = false;
    }
  });
})();
