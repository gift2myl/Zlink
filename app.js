(() => {
  'use strict';
  const plans = {
    self: {
      title: '优先推荐：鹿客 S6 Max',
      description: '纯自用、看重家用体验，日常开门不想依赖自如 App 或额外网关，可优先选择这款门锁。',
      next: '准备现有门锁与门边照片，确认门体适配，并说明是否需要远程功能。',
      category: '纯自用换新方案',
      summary: '鹿客 S6 Max：按自己的习惯开门，不用接入自如 App 体系。',
      reason: '适合自己住、希望选择面向家庭日常使用的智能门锁的业主。日常开门无需自如 App 或额外网关；远程功能可按需配置。',
      features: ['三面指脉识别', '结构光 3D 人脸识别', '天地双摄', '4.7 英寸内屏'],
      steps: ['准备现有门锁与门边照片，核对门厚、孔位、开向及锁体。', '说明家人的使用习惯，以及是否需要远程视频对讲、远程开门。', '确认型号、费用、安装项目和质保说明；新换装全系列随附一把机械钥匙，交付时现场核对。'],
      note: '远程视频对讲、远程开门需配置鹿客管家 App 和网络。选配功能以实际配置为准。'
    },
    new: {
      title: '优先了解：智能门锁换新',
      description: '先按家人的使用习惯比较型号，再确认门体适配；纯自用可优先了解鹿客 S6 Max。',
      next: '准备现有门锁、门边和锁体照片，说明家人的使用需要。',
      category: '换新方案',
      summary: '新换装全系列随附一把机械钥匙，安装交付时请现场核对。',
      reason: '适合希望换新、改善日常开门体验的业主。根据门体和使用需求选择，无需只看外观决定。',
      steps: ['准备现有门锁、门边和锁体照片，说明安装城市及使用需求。', '由服务人员核对门厚、孔位、开向及适配型号。', '确认型号、费用、安装项目与质保说明后，再安排换新。'],
      note: '型号、开门方式与质保范围，请按所选产品逐项确认。'
    },
    care: {
      title: '优先了解：旧锁维保',
      description: '锁还好用，不必急着换。先核对原有保障；已有故障时，先判断再处理。',
      next: '核对铭牌型号和质保情况；如有故障，请说明是否能正常开门。',
      category: '维保方案',
      summary: '先了解门锁状态，再确认可提供的检修或维保项目。',
      reason: '适合继续使用原锁、关注后续维修，或已经遇到故障的业主。是否可维修或纳入维保，需要先评估。',
      steps: ['核对门锁型号、安装时间，以及现有质保或服务记录。', '如有故障，说明能否正常开门、出现时间及具体表现，准备照片或视频。', '确认当地可提供的项目、配件范围、费用和安排时间后，再决定。'],
      note: '维保范围、费用与安排时间，请以确认的服务条款为准。'
    },
    mech: {
      title: '优先了解：机械锁安装',
      description: '更习惯用钥匙，或卧室不再需要智能锁，可以先评估机械锁改装。',
      next: '说明是入户门还是卧室门，准备现有门锁与门边照片。',
      category: '机械锁方案',
      summary: '先看门体与锁体适配，再确定拆旧及安装方式。',
      reason: '适合合租转自住后不再需要卧室智能锁，或明确偏好钥匙开门的业主。每扇门分别确认。',
      steps: ['说明入户门或卧室门、计划处理的数量，以及钥匙使用需求。', '由服务人员评估门厚、锁体、孔位及开向，确认改装条件。', '确认锁具、拆装项目、费用和旧锁处置方式后，再安排安装。'],
      note: '新换装全系列随附一把机械钥匙。具体锁具与安装项目以确认方案为准。'
    }
  };
  const buttons = [...document.querySelectorAll('[data-scene]')];
  const result = document.getElementById('recommendation');
  const explain = document.getElementById('explain-button');
  const dialog = document.getElementById('explain-dialog');
  const title = document.getElementById('result-title');
  let current = null;
  let opener = null;
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function selectScene(key, move = true) {
    if (!Object.hasOwn(plans, key)) return;
    const plan = plans[key];
    current = key;
    buttons.forEach(button => {
      const selected = button.dataset.scene === key;
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('.scene-check').textContent = selected ? '✓' : '↗';
    });
    result.classList.add('has-selection');
    text('result-label', '根据您的选择，优先推荐');
    text('result-title', plan.title);
    text('result-description', plan.description);
    const featureList = document.getElementById('result-features');
    featureList.replaceChildren();
    (plan.features || []).forEach(feature => { const item = document.createElement('li'); item.textContent = feature; featureList.append(item); });
    featureList.hidden = !plan.features;
    text('next-label', '下一步，先准备这些');
    text('result-next', plan.next);
    explain.disabled = false;
    explain.replaceChildren(document.createTextNode(key === 'self' ? '一键了解 S6 Max ' : '一键查看方案说明 '));
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '→'; explain.append(arrow);
    text('selection-status', `已选择。${plan.title}，可点击一键查看方案说明。`);
    if (move && window.matchMedia('(max-width: 700px)').matches) {
      title.focus({preventScroll: true});
      result.scrollIntoView({behavior: reduced.matches ? 'instant' : 'smooth', block: 'start'});
    }
  }

  function openExplanation(key, trigger) {
    if (!Object.hasOwn(plans, key)) return;
    const plan = plans[key];
    opener = trigger;
    text('dialog-category', plan.category);
    text('dialog-title', plan.title.replace(/^优先(?:了解|推荐)：/, ''));
    text('dialog-summary', plan.summary);
    text('dialog-reason', plan.reason);
    const features = document.getElementById('dialog-features'); features.replaceChildren();
    (plan.features || []).forEach(feature => { const item = document.createElement('li'); item.textContent = feature; features.append(item); });
    document.getElementById('dialog-features-block').hidden = !plan.features;
    const list = document.getElementById('dialog-steps'); list.replaceChildren();
    plan.steps.forEach(step => { const item = document.createElement('li'); item.textContent = step; list.append(item); });
    text('dialog-note', plan.note);
    dialog.showModal();
  }

  buttons.forEach(button => button.addEventListener('click', () => selectScene(button.dataset.scene)));
  explain.addEventListener('click', () => openExplanation(current, explain));
  document.querySelectorAll('[data-explain]').forEach(button => button.addEventListener('click', () => {
    selectScene(button.dataset.explain, false);
    openExplanation(button.dataset.explain, button);
  }));
  document.getElementById('dialog-close').addEventListener('click', () => dialog.close());
  document.getElementById('dialog-done').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { if (opener) opener.focus({preventScroll: true}); });
  const initialScene = new URL(window.location.href).searchParams.get('scene');
  if (initialScene) selectScene(initialScene, false);
})();
