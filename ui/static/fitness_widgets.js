(function() {
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const SESSION_ICONS = { lift: '🏋️', run: '🏃', cycle: '🚴', rest: '—' };
  const STATUS_COLORS = { matched: '#4ade80', planned: '#facc15', missed: '#f87171', skipped: '#9ca3af', rest: '#6b7280' };

  async function fetchFitness(endpoint) {
    const res = await fetch(`/fitness/${endpoint}`);
    if (!res.ok) return null;
    return res.json();
  }

  async function fetchNutrition(endpoint) {
    const res = await fetch(`/nutrition/${endpoint}`);
    if (!res.ok) return null;
    return res.json();
  }

  function verdictColor(verdict) {
    if (verdict === 'pass') return '#4ade80';
    if (verdict === 'close') return '#facc15';
    if (verdict === 'fail') return '#f87171';
    if (verdict === 'deload') return '#60a5fa';
    return '#9ca3af';
  }

  registerWidget({
    id: 'today-workout',
    title: "Today's Workout",
    async data() {
      return fetchFitness('widgets/today-workout');
    },
    render(data) {
      if (!data) return '<span class="empty-state">No workout data</span>';

      if (data.session_type === 'rest') {
        return '<div style="text-align:center;padding:20px;">– Rest day –</div>';
      }

      let html = '';

      if (data.garmin_match) {
        html += `<div style="margin-bottom:12px;"><span style="background:#4ade80;color:#000;padding:4px 8px;border-radius:12px;font-size:12px;">✓ Matched · ${data.garmin_match.duration_minutes} min · ${data.garmin_match.calories} cal</span></div>`;
      }

      html += `<div style="font-size:10px;color:var(--muted);margin-bottom:6px;">Click an exercise row to manage overrides.</div>`;
      html += `<table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:4px;">Exercise</th>
          <th style="text-align:left;padding:4px;">Prescribed</th>
          <th style="text-align:left;padding:4px;">Actual</th>
          <th style="text-align:left;padding:4px;">Status</th>
        </tr></thead><tbody>`;

      const dateStr = data.date;

      for (const ex of data.exercises) {
        const prescribed = `${ex.prescribed_sets}×${ex.prescribed_reps} @ ${ex.current_weight_lbs}lb`;

        let actual = '—';
        if (ex.actual_sets && ex.actual_sets.length > 0) {
          actual = ex.actual_sets.map(s =>
            `<span class="set-link" onclick="event.stopPropagation();">${s.weight_lbs}×${s.reps_completed}</span>`
          ).join(' / ');
        }

        const color = verdictColor(ex.last_verdict);
        const status = ex.last_verdict || 'pending';

        html += `<tr style="border-bottom:1px solid var(--border);cursor:pointer;" onclick="openWeekDayModal('${dateStr}')">
          <td style="padding:6px 4px;">${esc(ex.name)}</td>
          <td style="padding:6px 4px;font-size:12px;">${prescribed}</td>
          <td style="padding:6px 4px;font-size:12px;">${actual}</td>
          <td style="padding:6px 4px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px;"></span>
            <span style="font-size:11px;">${status}</span>
          </td>
        </tr>`;
      }

      html += `</tbody></table>`;
      html += `<div style="margin-top:12px;">
        <button onclick="syncGarminForToday()" style="background:transparent;border:1px solid var(--border);padding:4px 8px;cursor:pointer;color:var(--text);font-size:11px;">[Sync from Garmin]</button>
        <button onclick="openWeekDayModal('${dateStr}')" style="background:transparent;border:1px solid var(--border);padding:4px 8px;cursor:pointer;color:var(--accent);font-size:11px;margin-left:6px;">[Manage Day]</button>
      </div>`;

      return html;
    }
  });

  registerWidget({
    id: 'week-overview',
    title: 'Week Overview',
    async data() {
      return fetchFitness('widgets/week-overview');
    },
    render(data) {
      if (!data || !Array.isArray(data)) return '<span class="empty-state">No week data</span>';

      let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;">';
      
      for (const day of data) {
        const dateObj = new Date(day.date);
        const dayName = DAY_NAMES[dateObj.getDay()];
        const icon = SESSION_ICONS[day.session_type] || '—';
        const color = STATUS_COLORS[day.status] || '#9ca3af';
        
        html += `<div style="cursor:pointer;padding:8px 2px;border-radius:4px;background:var(--surface);" onclick="openWeekDayModal('${day.date}')">
          <div style="font-size:10px;color:var(--muted);">${dayName}</div>
          <div style="font-size:16px;margin:4px 0;">${icon}</div>
          <div style="height:3px;background:${color};border-radius:2px;"></div>
        </div>`;
      }
      
      html += '</div>';
      return html;
    }
  });

  // ── Shared helpers for nutrition bars ────────────────────────
  function _renderNutritionBars(data) {
    const target = data.calories_target || 0;
    const burned = data.calories_burned_garmin || 0;
    const macrosCurrent = data.macros_current || { protein_g: 0, carbs_g: 0, fat_g: 0 };
    const macrosTarget = data.macros_target || { protein_g: 0, carbs_g: 0, fat_g: 0 };

    // Compute calories from macros
    const calCurrent = Math.round(
      (macrosCurrent.protein_g || 0) * 4 +
      (macrosCurrent.carbs_g   || 0) * 4 +
      (macrosCurrent.fat_g     || 0) * 9
    );
    const calPct = target ? Math.min((calCurrent / target) * 100, 100) : 0;
    const calColor = 'var(--accent)';

    const source = data.calories_burned_source || 'none';
    const burnedLabel = source === 'garmin'    ? `${burned} cal (Garmin)`
                      : source === 'estimate'  ? `~${burned} cal (est.)`
                      : '';

    let html = `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:var(--muted);">
      <span>Target: <strong style="color:var(--text);">${target} cal</strong></span>
      ${burnedLabel ? `<span title="${source === 'estimate' ? 'Estimated from workout schedule — will update when Garmin syncs' : 'From Garmin'}">${burnedLabel}</span>` : ''}
    </div>`;

    // Calories bar
    html += `<div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
        <span>Calories</span>
        <span>${calCurrent} / ${target} cal</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${calPct}%;background:${calColor};transition:width .3s;"></div>
      </div>
    </div>`;

    const macroBars = [
      { label: 'Protein', current: Math.round(macrosCurrent.protein_g), target: macrosTarget.protein_g, unit: 'g' },
      { label: 'Carbs',   current: Math.round(macrosCurrent.carbs_g),   target: macrosTarget.carbs_g,   unit: 'g' },
      { label: 'Fat',     current: Math.round(macrosCurrent.fat_g),     target: macrosTarget.fat_g,     unit: 'g' },
    ];

    for (const m of macroBars) {
      const pct = m.target ? Math.min((m.current / m.target) * 100, 100) : 0;
      html += `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
          <span>${m.label}</span>
          <span>${m.current}${m.unit} / ${m.target}${m.unit}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s;"></div>
        </div>
      </div>`;
    }

    return html;
  }

  registerWidget({
    id: 'nutrition-today',
    title: "Today's Nutrition",
    async data() {
      return fetchNutrition('widgets/today');
    },
    render(data) {
      if (!data) return '<span class="empty-state">No nutrition data</span>';

      let html = _renderNutritionBars(data);

      const meals = data.meals || [];
      if (meals.length) {
        for (const meal of meals) {
          const slotLabel = meal.slot ? meal.slot.charAt(0).toUpperCase() + meal.slot.slice(1) : 'Meal';
          html += `<div style="margin-top:8px;padding:8px;background:var(--surface);border-radius:4px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">${slotLabel}</div>
            <div style="font-size:12px;cursor:pointer;color:var(--accent);" onclick="openMealModal(${meal.id}, '${data.date}')">${esc(meal.recipe_name)}</div>
            ${meal.calories_per_serving ? `<div style="font-size:10px;color:var(--muted);">${Math.round(meal.calories_per_serving * meal.servings)} cal · ${Math.round((meal.protein_per_serving || 0) * meal.servings)}g protein</div>` : ''}
          </div>`;
        }
      } else {
        html += '<div style="margin-top:12px;"><button onclick="nutritionWeekAction(\'generate\')" style="background:var(--accent);color:#000;border:none;padding:6px 12px;cursor:pointer;border-radius:4px;font-size:12px;">[Generate Meal Plan]</button></div>';
      }

      return html;
    }
  });

  const ALL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

  // ── Shared week state for Meal Plan / Grocery / Cook Schedule ─
  // Monday ISO string, null = current week
  window._nutritionWeek = null;

  function _getWeekMonday(offsetWeeks) {
    const today = new Date();
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + (offsetWeeks || 0) * 7);
    return monday.toISOString().split('T')[0];
  }

  function _nutritionWeekParam() {
    return window._nutritionWeek ? `?week=${window._nutritionWeek}` : '';
  }

  function _weekLabel(isoMonday) {
    if (!isoMonday) isoMonday = _getWeekMonday(0);
    const d = new Date(isoMonday + 'T12:00:00');
    const end = new Date(d); end.setDate(d.getDate() + 6);
    const fmt = dt => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    // Check if this is the current week
    const currentMonday = _getWeekMonday(0);
    if (isoMonday === currentMonday) return 'This Week';
    return `${fmt(d)} – ${fmt(end)}`;
  }

  function _renderWeekNav(hasPlan) {
    const week = window._nutritionWeek;
    const currentMonday = _getWeekMonday(0);
    const isCurrentWeek = !week || week === currentMonday;
    const label = _weekLabel(week);

    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:12px;">
      <button onclick="nutritionWeekAction('prev')" style="background:transparent;border:1px solid var(--border);padding:2px 7px;cursor:pointer;color:var(--text);border-radius:3px;font-size:11px;">‹</button>
      <span style="flex:1;text-align:center;font-size:11px;color:var(--muted);">${label}</span>
      <button onclick="nutritionWeekAction('next')" style="background:transparent;border:1px solid var(--border);padding:2px 7px;cursor:pointer;color:var(--text);border-radius:3px;font-size:11px;">›</button>
    </div>
    ${!hasPlan ? `<div style="margin-bottom:8px;"><button onclick="nutritionWeekAction('generate')" style="background:var(--accent);color:#000;border:none;padding:5px 12px;cursor:pointer;border-radius:4px;font-size:12px;width:100%;">Generate Plan for This Week</button></div>` : ''}`;
  }

  window.nutritionWeekAction = async function(action) {
    const currentMonday = _getWeekMonday(0);
    const week = window._nutritionWeek || currentMonday;

    if (action === 'prev') {
      const d = new Date(week + 'T12:00:00');
      d.setDate(d.getDate() - 7);
      window._nutritionWeek = d.toISOString().split('T')[0];
      renderAll();
    } else if (action === 'next') {
      const d = new Date(week + 'T12:00:00');
      d.setDate(d.getDate() + 7);
      window._nutritionWeek = d.toISOString().split('T')[0];
      renderAll();
    } else if (action === 'generate') {
      const weekParam = window._nutritionWeek ? `?week=${window._nutritionWeek}` : '';
      await fetch(`/nutrition/meal-plans/generate${weekParam}`, { method: 'POST' });
      renderAll();
    } else if (action === 'regenerate') {
      const weekParam = window._nutritionWeek ? `?week=${window._nutritionWeek}` : '';
      await fetch(`/nutrition/meal-plans/generate${weekParam}`, { method: 'POST' });
      renderAll();
    } else if (action === 'grocery') {
      const weekParam = window._nutritionWeek ? `?week=${window._nutritionWeek}` : '';
      await fetch(`/nutrition/grocery-list/generate${weekParam}`, { method: 'POST' });
      renderAll();
    }
  };

  window.openDayNutritionModal = async function(dateStr) {
    const data = await fetch(`/nutrition/widgets/day?day=${dateStr}`).then(r => r.json()).catch(() => null);
    if (!data) return;

    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    function renderDayModal() {
      let html = `<div class="modal-header"><h2>${dayLabel}</h2><button class="modal-close" onclick="closeModal()">&times;</button></div>`;
      html += `<div class="modal-body">`;
      html += _renderNutritionBars(data);

      const meals = data.meals || [];
      if (meals.length) {
        html += `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;">`;
        for (const meal of meals) {
          const slotLabel = meal.slot ? meal.slot.charAt(0).toUpperCase() + meal.slot.slice(1) : 'Meal';
          html += `<div style="margin-bottom:8px;padding:8px;background:var(--surface);border-radius:4px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">${slotLabel}</div>
            <div style="font-size:12px;cursor:pointer;color:var(--accent);" onclick="closeModal();openMealModal(${meal.id},'${dateStr}')">${esc(meal.recipe_name)}</div>
            ${meal.calories_per_serving ? `<div style="font-size:10px;color:var(--muted);">${Math.round(meal.calories_per_serving * meal.servings)} cal · ${Math.round((meal.protein_per_serving || 0) * meal.servings)}g protein</div>` : ''}
          </div>`;
        }
        html += `</div>`;
      } else {
        html += `<div style="margin-top:12px;color:var(--muted);font-size:12px;">No meals planned for this day.</div>`;
      }
      html += `</div>`;
      return html;
    }

    openModal(renderDayModal, null, null);
  };

  registerWidget({
    id: 'meal-plan',
    title: 'Meal Plan',
    async data() {
      return fetchNutrition(`widgets/meal-plan${_nutritionWeekParam()}`);
    },
    render(data) {
      const hasPlan = data && data.days && data.days.length > 0;
      let html = _renderWeekNav(hasPlan);

      if (!hasPlan) {
        return html + '<span class="empty-state">No meal plan for this week</span>';
      }

      window._currentMealPlanData = data;

      html += '<div style="font-size:12px;">';

      for (const day of data.days) {
        const dateObj = new Date(day.date + 'T12:00:00');
        const dayName = DAY_NAMES[dateObj.getDay()];
        const mealsMap = {};
        for (const m of (day.meals || [])) mealsMap[m.slot] = m;
        const hasMeals = day.meals && day.meals.length > 0;

        html += `<div style="border-bottom:1px solid var(--border);padding:6px 0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;">${dayName}</span>
            <span style="font-size:10px;color:var(--muted);font-weight:400;">${day.date}</span>
            ${hasMeals ? `<button onclick="openDayNutritionModal('${day.date}')" style="margin-left:auto;background:transparent;border:none;padding:0;cursor:pointer;color:var(--muted);font-size:10px;" title="Day nutrition summary">📊</button>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;">`;

        for (const slot of ALL_SLOTS) {
          const meal = mealsMap[slot];
          if (meal) {
            html += `<div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:9px;color:var(--muted);width:58px;flex-shrink:0;">${slot}</span>
              <span style="cursor:pointer;color:var(--accent);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="openMealModal(${meal.id},'${day.date}')">${esc(meal.recipe_name)}</span>
            </div>`;
          } else {
            html += `<div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:9px;color:var(--muted);width:58px;flex-shrink:0;">${slot}</span>
              <button onclick="openAddMealModal('${day.date}','${slot}')" style="background:transparent;border:none;padding:0;cursor:pointer;color:var(--muted);font-size:11px;">+ add</button>
            </div>`;
          }
        }

        html += `</div></div>`;
      }

      html += '</div>';
      html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">';
      html += '<button onclick="nutritionWeekAction(\'grocery\')" style="background:transparent;border:1px solid var(--border);padding:4px 8px;cursor:pointer;color:var(--text);font-size:11px;">[Grocery List]</button>';
      html += '<button onclick="nutritionWeekAction(\'regenerate\')" style="background:transparent;border:1px solid var(--border);padding:4px 8px;cursor:pointer;color:var(--text);font-size:11px;">[Regenerate Plan]</button>';
      html += '</div>';

      return html;
    }
  });

  registerWidget({
    id: 'grocery-list',
    title: 'Grocery List',
    async data() {
      return fetchNutrition(`grocery-list${_nutritionWeekParam()}`).catch(() => null);
    },
    render(data) {
      let html = _renderWeekNav(true);  // nav always shown; grocery doesn't drive plan creation

      if (!data || !data.sections || data.sections.length === 0) {
        return html + '<span class="empty-state">No grocery list — generate one from Meal Plan</span>';
      }

      for (const section of data.sections) {
        html += `<div style="margin-bottom:8px;">
          <div class="grocery-section" onclick="toggleGrocerySection(this)" style="cursor:pointer;padding:6px;background:var(--surface);border-radius:4px;font-size:12px;font-weight:500;">
            ${section.section} (${section.items.length})
            <span style="float:right;">▼</span>
          </div>
          <div class="grocery-items" style="padding:4px 8px;">`;

        for (const item of section.items) {
          html += `<div style="display:flex;align-items:center;padding:4px 0;font-size:12px;${item.checked ? 'text-decoration:line-through;color:var(--muted);' : ''}">
            <input type="checkbox" ${item.checked ? 'checked' : ''} onclick="toggleGroceryItem(${item.id}, this)" style="margin-right:8px;">
            <span style="flex:1;">${esc(item.name)}</span>
            <span style="color:var(--muted);">${item.quantity_needed} ${item.unit}</span>
          </div>`;
        }

        html += '</div></div>';
      }

      return html;
    }
  });

  registerWidget({
    id: 'cook-schedule',
    title: 'Cook Schedule',
    async data() {
      return fetchNutrition(`cook-events${_nutritionWeekParam()}`);
    },
    render(data) {
      let html = _renderWeekNav(true);

      if (!data || data.length === 0) {
        return html + `<span class="empty-state">No cook events this week</span>
          <div style="margin-top:8px;">
            <button onclick="openLogCookModal()" style="background:var(--accent);color:#000;border:none;padding:6px 12px;cursor:pointer;border-radius:4px;font-size:12px;">+ Log Cook</button>
          </div>`;
      }

      // Group by cook_date
      const byDate = {};
      for (const ev of data) {
        const d = ev.cook_date || 'Unknown';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(ev);
      }

      html += '<div style="font-size:12px;">';

      for (const dateStr of Object.keys(byDate).sort()) {
        const dateObj = new Date(dateStr + 'T12:00:00');
        const dayName = DAY_NAMES[dateObj.getDay()] || '';
        html += `<div style="border-bottom:1px solid var(--border);padding:6px 0;">
          <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:4px;">${dayName} <span style="font-weight:400;">${dateStr}</span></div>`;

        for (const ev of byDate[dateStr]) {
          const consumed = ev.servings_consumed ?? 0;
          const produced = ev.servings_produced ?? 0;
          const remaining = ev.servings_remaining ?? (produced - consumed);
          // Bar shows how much of the batch is assigned to meals (consumed = good)
          const assignedPct = produced > 0 ? Math.min(consumed / produced, 1) : 0;
          const surplus = remaining > 0;
          const barColor = assignedPct >= 1 ? 'var(--accent)' : assignedPct > 0 ? 'var(--warn)' : 'var(--border)';
          const surplusLabel = surplus ? `<span style="color:var(--accent);font-size:10px;">+${remaining.toFixed(1)} unassigned</span>` : '';

          html += `<div style="margin-bottom:6px;padding:6px;background:var(--surface);border-radius:4px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-weight:500;">${esc(ev.recipe_name || 'Unknown Recipe')}</span>
              <span style="font-size:10px;color:var(--muted);">${consumed.toFixed(0)} / ${produced} srv planned${surplus ? '' : ''}</span>
            </div>
            <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${Math.round(assignedPct * 100)}%;background:${barColor};border-radius:2px;"></div>
            </div>
            ${surplus ? `<div style="margin-top:3px;">${surplusLabel}</div>` : ''}
            ${ev.notes ? `<div style="font-size:10px;color:var(--muted);margin-top:3px;">${esc(ev.notes)}</div>` : ''}
          </div>`;
        }

        html += `</div>`;
      }

      html += '</div>';
      html += `<div style="margin-top:10px;">
        <button onclick="openLogCookModal()" style="background:transparent;border:1px solid var(--accent);padding:4px 10px;cursor:pointer;color:var(--accent);font-size:11px;border-radius:4px;">+ Log Cook</button>
      </div>`;

      return html;
    }
  });

  window.syncGarmin = async function() {
    try {
      await fetch('/fitness/sync/garmin', { method: 'POST' });
      renderAll();
    } catch (e) {
      console.error('Sync failed:', e);
    }
  };

  window.syncGarminForToday = async function() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(`/fitness/sync/garmin/date/${today}`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'no_activity') {
        alert('No Garmin activity found for today');
      } else {
        renderAll();
      }
    } catch (e) {
      console.error('Sync failed:', e);
    }
  };

  window.editSet = async function(setId, exerciseId, exerciseName, currentWeight, currentReps) {
    const weight = prompt(`Edit weight for ${exerciseName}:`, currentWeight);
    if (weight === null) return;
    const reps = prompt(`Edit reps for ${exerciseName}:`, currentReps);
    if (reps === null) return;
    
    try {
      await fetch(`/fitness/set-logs/${setId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_lbs: parseFloat(weight), reps_completed: parseInt(reps) })
      });
      renderAll();
    } catch (e) {
      console.error('Update failed:', e);
    }
  };

  window.addSet = async function(workoutLogId) {
    try {
      const exercises = await fetch('/fitness/exercises').then(r => r.json());
      const exNames = exercises.map(e => `${e.id}: ${e.name}`).join('\n');
      const exId = prompt(`Enter exercise ID:\n${exNames}`);
      if (!exId) return;
      
      const setNum = prompt('Set number:', '1');
      if (setNum === null) return;
      
      const weight = prompt('Weight (lbs):', '0');
      if (weight === null) return;
      
      const reps = prompt('Reps:', '0');
      if (reps === null) return;
      
      await fetch(`/fitness/workout-logs/${workoutLogId}/sets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exercise_id: parseInt(exId),
          set_number: parseInt(setNum),
          weight_lbs: parseFloat(weight),
          reps_completed: parseInt(reps)
        })
      });
      renderAll();
    } catch (e) {
      console.error('Add set failed:', e);
    }
  };

  window.generateMealPlan = async function() {
    await nutritionWeekAction('generate');
  };

  window.swapMeal = async function(mealId) {
    try {
      await fetch(`/nutrition/planned-meals/${mealId}/swap`, { method: 'POST' });
      renderAll();
    } catch (e) {
      console.error('Swap failed:', e);
    }
  };

  window.openMealModal = async function(mealId, dateStr) {
    // Fetch meal info from the plan widget for the current viewed week
    const mealData = await fetchNutrition(`widgets/meal-plan${_nutritionWeekParam()}`);
    const allRecipes = await fetchNutrition('recipes');

    let mealInfo = null;
    for (const day of (mealData.days || [])) {
      for (const m of (day.meals || [])) {
        if (m.id === mealId) { mealInfo = m; break; }
      }
      if (mealInfo) break;
    }

    if (!mealInfo) return;

    const recipeDetails = await fetchNutrition(`recipes/${mealInfo.recipe_id}`);
    const slotLabel = mealInfo.slot ? mealInfo.slot.charAt(0).toUpperCase() + mealInfo.slot.slice(1) : 'Meal';

    let html = `<div class="modal-header"><h2>${slotLabel}: ${esc(mealInfo.recipe_name)}</h2><button class="modal-close" onclick="closeModal()">&times;</button></div>`;
    html += `<div class="modal-body">`;

    if (recipeDetails && recipeDetails.description) {
      html += `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">${esc(recipeDetails.description)}</p>`;
    }

    html += `<div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px;">`;
    if (recipeDetails && recipeDetails.calories_per_serving) html += `<span>${recipeDetails.calories_per_serving} cal/serving</span>`;
    if (recipeDetails && recipeDetails.protein_per_serving)  html += `<span>${recipeDetails.protein_per_serving}g protein</span>`;
    if (recipeDetails && (recipeDetails.prep_minutes || recipeDetails.cook_minutes)) html += `<span>${recipeDetails.prep_minutes || 0}p / ${recipeDetails.cook_minutes || 0}c min</span>`;
    html += `</div>`;

    if (recipeDetails && recipeDetails.ingredients && recipeDetails.ingredients.length > 0) {
      html += `<div style="margin-bottom:16px;"><strong style="font-size:12px;">Ingredients</strong>`;
      html += `<ul style="font-size:12px;margin:4px 0;padding-left:20px;">`;
      for (const ing of recipeDetails.ingredients) {
        html += `<li>${ing.quantity_per_serving} ${ing.unit || ''} ${esc(ing.name)}</li>`;
      }
      html += `</ul></div>`;
    }

    html += `<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">`;
    html += `<label style="font-size:12px;display:block;margin-bottom:6px;">Replace with:</label>`;
    html += `<select id="recipe-override-select" style="width:100%;padding:6px;margin-bottom:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:12px;">`;
    html += `<option value="">-- Select a recipe --</option>`;
    for (const r of (allRecipes || [])) {
      const selected = r.id === mealInfo.recipe_id ? 'selected' : '';
      html += `<option value="${r.id}" ${selected}>${esc(r.name)} (${r.calories_per_serving || '?'} cal)</option>`;
    }
    html += `</select>`;
    html += `<div style="display:flex;gap:8px;">`;
    html += `<button onclick="overrideMeal(${mealId})" style="flex:1;background:var(--accent);color:#000;border:none;padding:8px;cursor:pointer;border-radius:4px;font-size:12px;">Replace</button>`;
    html += `<button onclick="deletePlannedMeal(${mealId})" style="flex:1;background:transparent;color:var(--danger);border:1px solid var(--danger);padding:8px;cursor:pointer;border-radius:4px;font-size:12px;">Delete</button>`;
    html += `</div></div></div>`;

    openModal(() => html, null, () => renderAll());
  };

  window.overrideMeal = async function(mealId) {
    const select = document.getElementById('recipe-override-select');
    const recipeId = select.value;
    
    if (!recipeId) {
      return;
    }
    
    try {
      await fetch(`/nutrition/planned-meals/${mealId}/override?recipe_id=${recipeId}`, { method: 'PATCH' });
      closeModal();
      renderAll();
    } catch (e) {
      console.error('Override failed:', e);
    }
  };

  window.deletePlannedMeal = async function(mealId) {
    if (!confirm('Remove this meal from the plan?')) {
      return;
    }
    
    try {
      await fetch(`/nutrition/planned-meals/${mealId}`, { method: 'DELETE' });
      closeModal();
      renderAll();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  window.openAddMealModal = async function(dateStr, slot) {
    const mealData = window._currentMealPlanData;
    if (!mealData || !mealData.plan_id) return;

    const allRecipes = await fetchNutrition('recipes');
    const slotLabel = slot ? slot.charAt(0).toUpperCase() + slot.slice(1) : 'Meal';
    const slotOpts = ALL_SLOTS.map(s =>
      `<option value="${s}" ${s === slot ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join('');

    let html = `<div class="modal-header"><h2>Add ${slotLabel}</h2><button class="modal-close" onclick="closeModal()">&times;</button></div>`;
    html += `<div class="modal-body">`;
    html += `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">${dateStr}</p>`;

    html += `<div class="modal-field"><label>Slot</label>
      <select id="add-meal-slot-select" style="width:100%;padding:6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">${slotOpts}</select>
    </div>`;

    html += `<div class="modal-field"><label>Recipe</label>
      <select id="add-meal-recipe-select" style="width:100%;padding:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">
        <option value="">-- Select a recipe --</option>`;
    for (const r of (allRecipes || [])) {
      html += `<option value="${r.id}">${esc(r.name)} (${r.calories_per_serving || '?'} cal)</option>`;
    }
    html += `</select></div>`;

    html += `<button onclick="addMealToPlan('${dateStr}', ${mealData.plan_id})" style="width:100%;background:var(--accent);color:#000;border:none;padding:10px;cursor:pointer;border-radius:4px;font-size:13px;margin-top:4px;">Add to Plan</button>`;
    html += `</div>`;

    openModal(() => html, null, () => renderAll());
  };

  window.addMealToPlan = async function(dateStr, planId) {
    const recipeId = document.getElementById('add-meal-recipe-select')?.value;
    const slot = document.getElementById('add-meal-slot-select')?.value || 'dinner';

    if (!recipeId) return;

    try {
      const body = { recipe_id: parseInt(recipeId), meal_date: dateStr, slot, servings: 2.0 };
      await fetch(`/nutrition/meal-plans/${planId}/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      closeModal();
      renderAll();
    } catch (e) {
      console.error('Add meal failed:', e);
    }
  };

  window.generateGroceryList = async function() {
    await nutritionWeekAction('grocery');
  };

  window.toggleGroceryItem = async function(itemId, checkbox) {
    try {
      await fetch(`/nutrition/grocery-items/${itemId}/check`, { method: 'PATCH' });
      renderAll();
    } catch (e) {
      checkbox.checked = !checkbox.checked;
    }
  };

  window.toggleGrocerySection = function(el) {
    const items = el.nextElementSibling;
    items.style.display = items.style.display === 'none' ? 'block' : 'none';
  };

  // ── Cook Event Modal ─────────────────────────────────────────

  window.openLogCookModal = async function() {
    const recipes = await fetchNutrition('recipes');
    if (!recipes) return;

    const today = new Date().toISOString().split('T')[0];
    const opts = recipes.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');

    openModal(() => `
      <div class="modal-header">
        <h2>Log Cook Event</h2>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Recipe</label>
          <select id="cook-recipe-select" style="width:100%;padding:6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">
            ${opts}
          </select>
        </div>
        <div class="modal-field">
          <label>Cook Date</label>
          <input type="date" id="cook-date-input" value="${today}"
            style="width:100%;padding:6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">
        </div>
        <div class="modal-field">
          <label>Servings Produced</label>
          <input type="number" id="cook-servings-input" value="4" min="0.5" step="0.5"
            style="width:100%;padding:6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">
        </div>
        <div class="modal-field">
          <label>Notes (optional)</label>
          <input type="text" id="cook-notes-input" placeholder="Any cooking notes..."
            style="width:100%;padding:6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">
        </div>
        <button onclick="submitCookEvent()"
          style="width:100%;background:var(--accent);color:#000;border:none;padding:10px;cursor:pointer;border-radius:4px;font-size:13px;margin-top:4px;">Log Cook</button>
      </div>`,
    null,
    () => renderAll()
    );
  };

  window.submitCookEvent = async function() {
    const recipeId = parseInt(document.getElementById('cook-recipe-select')?.value || '0');
    const cookDate = document.getElementById('cook-date-input')?.value;
    const servings = parseFloat(document.getElementById('cook-servings-input')?.value || '4');
    const notes = document.getElementById('cook-notes-input')?.value?.trim() || null;

    if (!recipeId || !cookDate) return;

    try {
      await fetch('/nutrition/cook-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe_id: recipeId, cook_date: cookDate, servings_produced: servings, notes }),
      });
      closeModal();
      renderAll();
    } catch (e) {
      console.error('Log cook failed:', e);
    }
  };

  // ── Week-day modal: skip, override exercises, add exercise, regenerate ──

  window.openWeekDayModal = function(dateStr) {
    fetchFitness(`schedule/${dateStr}`)
      .then(data => {
        if (!data) {
          openModal(
            () => `<div class="modal-header"><h2>${dateStr}</h2><button class="modal-close" onclick="closeModal()">&times;</button></div><div class="modal-body"><p>No workout scheduled</p></div>`,
            null,
            () => renderAll()
          );
          return;
        }
        openModal(() => _renderDayModal(data, dateStr), null, () => renderAll());
      });
  };

  function _renderDayModal(data, dateStr) {
    const dayId = data.day_id;
    const isRest = data.session_type === 'rest';
    const isSkipped = data.status === 'skipped';

    let html = `<div class="modal-header">
      <h2>${dateStr}${data.template_name ? ' — ' + esc(data.template_name) : ''}</h2>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>`;
    html += `<div class="modal-body">`;

    // Status banner
    if (isSkipped) {
      html += `<div style="padding:6px 10px;background:#9ca3af22;border-radius:4px;font-size:12px;color:var(--muted);margin-bottom:12px;">This day is marked as skipped.</div>`;
    }

    if (isRest) {
      html += `<p style="text-align:center;padding:12px;color:var(--muted);">— Rest day —</p>`;
    } else {
      // Exercise table with per-row skip + override controls
      html += `<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px;">`;
      html += `<thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:4px;">Exercise</th>
        <th style="text-align:left;padding:4px;">Sets×Reps</th>
        <th style="text-align:left;padding:4px;">Weight</th>
        <th style="padding:4px;"></th>
      </tr></thead><tbody>`;

      for (const ex of (data.exercises || [])) {
        const weight = ex.current_weight_lbs ? `${ex.current_weight_lbs} lb` : '—';
        html += `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 4px;">${esc(ex.name)}</td>
          <td style="padding:6px 4px;">
            <span id="ex-label-${ex.exercise_id}">${ex.prescribed_sets}×${ex.prescribed_reps}</span>
          </td>
          <td style="padding:6px 4px;">${weight}</td>
          <td style="padding:4px;text-align:right;white-space:nowrap;">
            <button onclick="toggleExOverride(${dayId},'${dateStr}',${ex.exercise_id},'${esc(ex.name)}',${ex.prescribed_sets},${ex.prescribed_reps})"
              style="background:transparent;border:1px solid var(--border);padding:2px 6px;cursor:pointer;font-size:10px;color:var(--text);margin-right:3px;">Override</button>
            <button onclick="skipExercise(${dayId},'${dateStr}',${ex.exercise_id})"
              style="background:transparent;border:1px solid var(--border);padding:2px 6px;cursor:pointer;font-size:10px;color:var(--danger);">Skip</button>
          </td>
        </tr>`;
      }

      html += `</tbody></table>`;

      // Add ad-hoc exercise
      html += `<div style="margin-bottom:12px;">
        <button onclick="openAddExercisePanel(${dayId},'${dateStr}')"
          style="background:transparent;border:1px solid var(--accent);padding:4px 10px;cursor:pointer;font-size:11px;color:var(--accent);border-radius:4px;">+ Add Exercise</button>
      </div>`;
    }

    // Day-level actions
    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:12px;margin-top:4px;">`;
    if (!isSkipped && dayId) {
      html += `<button onclick="skipDay(${dayId},'${dateStr}')"
        style="background:transparent;border:1px solid var(--border);padding:6px 12px;cursor:pointer;font-size:12px;color:var(--muted);border-radius:4px;">Skip Day</button>`;
    }
    html += `<button onclick="regenerateSchedule()"
      style="background:transparent;border:1px solid var(--border);padding:6px 12px;cursor:pointer;font-size:12px;color:var(--text);border-radius:4px;">Regenerate Week</button>`;
    html += `</div>`;

    html += `</div>`;
    return html;
  }

  window.skipDay = async function(dayId, dateStr) {
    if (!confirm(`Skip workout on ${dateStr}?`)) return;
    try {
      await fetch(`/fitness/scheduled-days/${dayId}/skip`, { method: 'PATCH' });
      // Reload the modal content with updated data
      const data = await fetchFitness(`schedule/${dateStr}`);
      if (data) refreshModal(() => _renderDayModal(data, dateStr));
      renderAll();
    } catch (e) {
      console.error('Skip day failed:', e);
    }
  };

  window.skipExercise = async function(dayId, dateStr, exerciseId) {
    try {
      await fetch(`/fitness/scheduled-days/${dayId}/overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_id: exerciseId, action: 'skip' }),
      });
      const data = await fetchFitness(`schedule/${dateStr}`);
      if (data) refreshModal(() => _renderDayModal(data, dateStr));
      renderAll();
    } catch (e) {
      console.error('Skip exercise failed:', e);
    }
  };

  window.toggleExOverride = function(dayId, dateStr, exerciseId, exName, currentSets, currentReps) {
    const existingPanel = document.getElementById(`override-panel-${exerciseId}`);
    if (existingPanel) { existingPanel.remove(); return; }

    // Find the table row and inject an override form below it
    const label = document.getElementById(`ex-label-${exerciseId}`);
    if (!label) return;
    const row = label.closest('tr');
    if (!row) return;

    const panel = document.createElement('tr');
    panel.id = `override-panel-${exerciseId}`;
    panel.innerHTML = `<td colspan="4" style="padding:8px;background:var(--surface);border-bottom:1px solid var(--border);">
      <div style="display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;">
        <span style="color:var(--muted);">${esc(exName)} override:</span>
        <label>Sets <input type="number" id="ov-sets-${exerciseId}" value="${currentSets}" min="1" max="20"
          style="width:45px;padding:2px 4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:12px;"></label>
        <label>Reps <input type="number" id="ov-reps-${exerciseId}" value="${currentReps}" min="1" max="50"
          style="width:45px;padding:2px 4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:12px;"></label>
        <button onclick="applyExOverride(${dayId},'${dateStr}',${exerciseId})"
          style="background:var(--accent);color:#000;border:none;padding:3px 10px;cursor:pointer;border-radius:3px;font-size:11px;">Apply</button>
        <button onclick="document.getElementById('override-panel-${exerciseId}').remove()"
          style="background:transparent;border:none;cursor:pointer;color:var(--muted);font-size:11px;">Cancel</button>
      </div>
    </td>`;
    row.after(panel);
  };

  window.applyExOverride = async function(dayId, dateStr, exerciseId) {
    const sets = parseInt(document.getElementById(`ov-sets-${exerciseId}`)?.value || '0');
    const reps = parseInt(document.getElementById(`ov-reps-${exerciseId}`)?.value || '0');
    if (!sets || !reps) return;
    try {
      await fetch(`/fitness/scheduled-days/${dayId}/overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_id: exerciseId, action: 'override', prescribed_sets: sets, prescribed_reps: reps }),
      });
      const data = await fetchFitness(`schedule/${dateStr}`);
      if (data) refreshModal(() => _renderDayModal(data, dateStr));
      renderAll();
    } catch (e) {
      console.error('Override exercise failed:', e);
    }
  };

  window.openAddExercisePanel = async function(dayId, dateStr) {
    const exercises = await fetchFitness('exercises');
    if (!exercises) return;

    const existingPanel = document.getElementById('add-exercise-panel');
    if (existingPanel) { existingPanel.remove(); return; }

    // Inject a form at the bottom of the modal-body
    const body = document.querySelector('#modal .modal-body');
    if (!body) return;

    const div = document.createElement('div');
    div.id = 'add-exercise-panel';
    div.style.cssText = 'border-top:1px solid var(--border);padding-top:12px;margin-top:4px;';

    const opts = exercises.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    div.innerHTML = `
      <div style="font-size:12px;color:var(--text);margin-bottom:8px;font-weight:500;">Add exercise to this day</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px;">
        <select id="add-ex-select" style="flex:1;min-width:140px;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:12px;">${opts}</select>
        <label>Sets <input type="number" id="add-ex-sets" value="3" min="1" max="20"
          style="width:45px;padding:2px 4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:12px;"></label>
        <label>Reps <input type="number" id="add-ex-reps" value="8" min="1" max="50"
          style="width:45px;padding:2px 4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:12px;"></label>
        <button onclick="applyAddExercise(${dayId},'${dateStr}')"
          style="background:var(--accent);color:#000;border:none;padding:4px 10px;cursor:pointer;border-radius:3px;font-size:11px;">Add</button>
        <button onclick="document.getElementById('add-exercise-panel').remove()"
          style="background:transparent;border:none;cursor:pointer;color:var(--muted);font-size:11px;">Cancel</button>
      </div>`;
    body.appendChild(div);
  };

  window.applyAddExercise = async function(dayId, dateStr) {
    const exerciseId = parseInt(document.getElementById('add-ex-select')?.value || '0');
    const sets = parseInt(document.getElementById('add-ex-sets')?.value || '0');
    const reps = parseInt(document.getElementById('add-ex-reps')?.value || '0');
    if (!exerciseId || !sets || !reps) return;
    try {
      await fetch(`/fitness/scheduled-days/${dayId}/overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_id: exerciseId, action: 'add', prescribed_sets: sets, prescribed_reps: reps }),
      });
      const data = await fetchFitness(`schedule/${dateStr}`);
      if (data) refreshModal(() => _renderDayModal(data, dateStr));
      renderAll();
    } catch (e) {
      console.error('Add exercise failed:', e);
    }
  };

  window.regenerateSchedule = async function() {
    if (!confirm('Regenerate next week\'s schedule? This will replace any planned (unmatched) days.')) return;
    try {
      await fetch('/fitness/schedule/generate', { method: 'POST' });
      closeModal();
      renderAll();
    } catch (e) {
      console.error('Regenerate failed:', e);
    }
  };
})();
