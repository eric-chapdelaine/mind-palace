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

      html += '<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:4px;">Exercise</th><th style="text-align:left;padding:4px;">Prescribed</th><th style="text-align:left;padding:4px;">Actual</th><th style="text-align:left;padding:4px;">Status</th></tr></thead><tbody>';

      for (const ex of data.exercises) {
        const prescribed = `${ex.prescribed_sets} × ${ex.prescribed_reps} @ ${ex.current_weight_lbs} lb`;
        
        let actual = '—';
        if (ex.actual_sets && ex.actual_sets.length > 0) {
          actual = ex.actual_sets.map(s => s.reps_completed).join(' / ');
        }

        const color = verdictColor(ex.last_verdict);
        const status = ex.last_verdict || 'pending';

        html += `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 4px;">${esc(ex.name)}</td>
          <td style="padding:6px 4px;">${prescribed}</td>
          <td style="padding:6px 4px;">${actual}</td>
          <td style="padding:6px 4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px;"></span>${status}</td>
        </tr>`;
      }

      html += '</tbody></table>';
      html += '<div style="margin-top:12px;font-size:11px;color:var(--muted);">';
      html += '<button onclick="syncGarmin()" style="background:transparent;border:1px solid var(--border);padding:4px 8px;cursor:pointer;color:var(--text);font-size:11px;">[Sync Now]</button>';
      html += '</div>';

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

  registerWidget({
    id: 'nutrition-today',
    title: "Today's Nutrition",
    async data() {
      return fetchNutrition('widgets/today');
    },
    render(data) {
      if (!data) return '<span class="empty-state">No nutrition data</span>';

      const target = data.calories_target || 0;
      const burned = data.calories_burned_garmin || 0;
      const macrosCurrent = data.macros_current || { protein_g: 0, carbs_g: 0, fat_g: 0 };
      const macrosTarget = data.macros_target || { protein_g: 0, carbs_g: 0, fat_g: 0 };

      let html = `<div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:13px;">
        <span>Target: ${target} cal</span>
        <span style="color:var(--muted);">Burned: ${burned} cal (Garmin)</span>
      </div>`;

      const macroBars = [
        { label: 'Protein', current: macrosCurrent.protein_g, target: macrosTarget.protein_g },
        { label: 'Carbs', current: macrosCurrent.carbs_g, target: macrosTarget.carbs_g },
        { label: 'Fat', current: macrosCurrent.fat_g, target: macrosTarget.fat_g }
      ];

      for (const m of macroBars) {
        const pct = Math.min((m.current / m.target) * 100, 100);
        html += `<div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
            <span>${m.label}</span>
            <span>${m.current}g / ${m.target}g</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:var(--accent);"></div>
          </div>
        </div>`;
      }

      if (data.lunch) {
        html += `<div style="margin-top:12px;padding:8px;background:var(--surface);border-radius:4px;">
          <div style="font-size:11px;color:var(--muted);">Lunch</div>
          <div style="font-size:12px;">${esc(data.lunch.recipe_name)}</div>
          ${data.lunch.note ? `<div style="font-size:10px;color:var(--muted);">${data.lunch.note}</div>` : ''}
        </div>`;
      }

      if (data.dinner) {
        html += `<div style="margin-top:8px;padding:8px;background:var(--surface);border-radius:4px;">
          <div style="font-size:11px;color:var(--muted);">Dinner</div>
          <div style="font-size:12px;cursor:pointer;color:var(--accent);" onclick="openTodaysDinnerModal()">${esc(data.dinner.recipe_name)}</div>
          <div style="font-size:10px;color:var(--muted);">${data.dinner.calories_per_serving} cal · ${data.dinner.protein_per_serving}g protein</div>
        </div>`;
      }

      if (!data.dinner && !data.lunch) {
        html += '<div style="margin-top:12px;"><button onclick="generateMealPlan()" style="background:var(--accent);color:#000;border:none;padding:6px 12px;cursor:pointer;border-radius:4px;font-size:12px;">[Generate Meal Plan]</button></div>';
      }

      return html;
    }
  });

  registerWidget({
    id: 'meal-plan',
    title: 'Meal Plan',
    async data() {
      return fetchNutrition('widgets/meal-plan');
    },
    render(data) {
      if (!data || !data.meals || data.meals.length === 0) {
        return '<span class="empty-state">No meal plan yet</span>';
      }

      let html = '<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:4px;">Day</th><th style="text-align:left;padding:4px;">Lunch</th><th style="text-align:left;padding:4px;">Dinner</th><th></th></tr></thead><tbody>';

      window._currentMealPlanData = data;
      
      for (let i = 0; i < data.meals.length; i++) {
        const m = data.meals[i];
        const dateObj = new Date(m.date);
        const dayName = DAY_NAMES[dateObj.getDay()];

        const lunch = m.lunch ? `<span>${esc(m.lunch.recipe_name)}</span>` : '<span style="color:var(--muted)">—</span>';
        const dinner = m.dinner ? `<span style="cursor:pointer;color:var(--accent);" onclick="openMealModal(${m.dinner.id}, '${m.date}')">${esc(m.dinner.recipe_name)}</span>` : `<button onclick="openAddMealModal('${m.date}')" style="background:transparent;border:none;padding:0;cursor:pointer;color:var(--accent);font-size:12px;">+ Add</button>`;

        html += `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px 4px;">${dayName}</td>
          <td style="padding:6px 4px;">${lunch}</td>
          <td style="padding:6px 4px;">${dinner}</td>
          <td style="padding:6px 4px;text-align:right;">${m.dinner ? `<button onclick="openMealModal(${m.dinner.id}, '${m.date}')" style="background:transparent;border:1px solid var(--border);padding:2px 6px;cursor:pointer;font-size:10px;color:var(--muted);">Edit</button>` : `<button onclick="openAddMealModal('${m.date}')" style="background:transparent;border:1px solid var(--border);padding:2px 6px;cursor:pointer;font-size:10px;color:var(--muted);">Add</button>`}</td>
        </tr>`;
      }

      html += '</tbody></table>';
      html += '<div style="margin-top:12px;"><button onclick="generateGroceryList()" style="background:transparent;border:1px solid var(--border);padding:4px 8px;cursor:pointer;color:var(--text);font-size:11px;">[Generate Grocery List]</button></div>';

      return html;
    }
  });

  registerWidget({
    id: 'grocery-list',
    title: 'Grocery List',
    async data() {
      return fetchNutrition('grocery-list');
    },
    render(data) {
      if (!data || !data.sections || data.sections.length === 0) {
        return '<span class="empty-state">No grocery list</span>';
      }

      let html = '';

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

      if (data.week_start_date) {
        html += `<div style="margin-top:12px;font-size:10px;color:var(--muted);">Week of ${data.week_start_date}</div>`;
      }

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

  window.generateMealPlan = async function() {
    try {
      await fetch('/nutrition/meal-plans/generate', { method: 'POST' });
      renderAll();
    } catch (e) {
      console.error('Meal plan generation failed:', e);
    }
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
    const mealData = await fetchNutrition(`widgets/meal-plan`);
    const allRecipes = await fetchNutrition('recipes');
    
    let mealInfo = null;
    for (const day of mealData.meals) {
      if (day.dinner && day.dinner.id === mealId) {
        mealInfo = day.dinner;
        break;
      }
    }
    
    if (!mealInfo) {
      return;
    }
    
    const recipeDetails = await fetchNutrition(`recipes/${mealInfo.recipe_id}`);
    
    let html = `<div class="modal-header"><h2>${mealInfo.recipe_name}</h2><button class="modal-close" onclick="closeModal()">&times;</button></div>`;
    html += `<div class="modal-body">`;
    
    if (recipeDetails.description) {
      html += `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">${esc(recipeDetails.description)}</p>`;
    }
    
    html += `<div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px;">`;
    if (recipeDetails.calories_per_serving) {
      html += `<span>${recipeDetails.calories_per_serving} cal</span>`;
    }
    if (recipeDetails.protein_per_serving) {
      html += `<span>${recipeDetails.protein_per_serving}g protein</span>`;
    }
    if (recipeDetails.prep_minutes || recipeDetails.cook_minutes) {
      html += `<span>${recipeDetails.prep_minutes || 0} prep / ${recipeDetails.cook_minutes || 0} cook min</span>`;
    }
    html += `</div>`;
    
    if (recipeDetails.ingredients && recipeDetails.ingredients.length > 0) {
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
    for (const r of allRecipes) {
      const selected = r.id === mealInfo.recipe_id ? 'selected' : '';
      html += `<option value="${r.id}" ${selected}>${esc(r.name)} (${r.calories_per_serving || '?'} cal)</option>`;
    }
    html += `</select>`;
    html += `<div style="display:flex;gap:8px;">`;
    html += `<button onclick="overrideMeal(${mealId})" style="flex:1;background:var(--accent);color:#000;border:none;padding:8px;cursor:pointer;border-radius:4px;font-size:12px;">Replace</button>`;
    html += `<button onclick="deletePlannedMeal(${mealId})" style="flex:1;background:transparent;color:var(--danger);border:1px solid var(--danger);padding:8px;cursor:pointer;border-radius:4px;font-size:12px;">Delete</button>`;
    html += `</div>`;
    html += `</div>`;
    
    html += `</div>`;
    
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

  window.openTodaysDinnerModal = async function() {
    const data = await fetchNutrition('widgets/today');
    if (!data || !data.dinner || !data.dinner.meal_id) {
      return;
    }
    openMealModal(data.dinner.meal_id, data.date);
  };

  window.openAddMealModal = async function(dateStr) {
    const mealData = window._currentMealPlanData;
    if (!mealData || !mealData.plan_id) {
      return;
    }
    
    const allRecipes = await fetchNutrition('recipes');
    
    let html = `<div class="modal-header"><h2>Add a Meal</h2><button class="modal-close" onclick="closeModal()">&times;</button></div>`;
    html += `<div class="modal-body">`;
    html += `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">Select a recipe for ${dateStr}:</p>`;
    
    html += `<select id="add-meal-recipe-select" style="width:100%;padding:8px;margin-bottom:12px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">`;
    html += `<option value="">-- Select a recipe --</option>`;
    for (const r of allRecipes) {
      html += `<option value="${r.id}">${esc(r.name)} (${r.calories_per_serving || '?'} cal)</option>`;
    }
    html += `</select>`;
    
    html += `<button onclick="addMealToPlan('${dateStr}', ${mealData.plan_id})" style="width:100%;background:var(--accent);color:#000;border:none;padding:10px;cursor:pointer;border-radius:4px;font-size:13px;">Add to Plan</button>`;
    html += `</div>`;
    
    openModal(() => html, null, () => renderAll());
  };

  window.addMealToPlan = async function(dateStr, planId) {
    const select = document.getElementById('add-meal-recipe-select');
    const recipeId = select.value;
    
    if (!recipeId) {
      return;
    }
    
    try {
      await fetch(`/nutrition/meal-plans/${planId}/meals?recipe_id=${recipeId}&meal_date=${dateStr}&slot=dinner`, { method: 'POST' });
      closeModal();
      renderAll();
    } catch (e) {
      console.error('Add meal failed:', e);
    }
  };

  window.generateGroceryList = async function() {
    try {
      await fetch('/nutrition/grocery-list/generate', { method: 'POST' });
      renderAll();
    } catch (e) {
      console.error('Grocery list generation failed:', e);
    }
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
        
        let html = `<div class="modal-header"><h2>${dateStr}</h2><button class="modal-close" onclick="closeModal()">&times;</button></div>`;
        html += `<div class="modal-body">`;
        
        if (data.session_type === 'rest') {
          html += `<p style="text-align:center;padding:20px;">— Rest day —</p>`;
        } else {
          html += `<p style="margin-bottom:12px;"><strong>${data.template_name || data.session_type}</strong></p>`;
          html += `<table style="width:100%;font-size:13px;border-collapse:collapse;">`;
          html += `<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:4px;">Exercise</th><th style="text-align:left;padding:4px;">Sets×Reps</th><th style="text-align:left;padding:4px;">Weight</th></tr></thead><tbody>`;
          
          for (const ex of (data.exercises || [])) {
            const weight = ex.current_weight_lbs ? `${ex.current_weight_lbs} lb` : '—';
            html += `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px 4px;">${esc(ex.name)}</td>
              <td style="padding:6px 4px;">${ex.prescribed_sets}×${ex.prescribed_reps}</td>
              <td style="padding:6px 4px;">${weight}</td>
            </tr>`;
          }
          
          html += `</tbody></table>`;
        }
        
        html += `</div>`;
        
        openModal(() => html, null, () => renderAll());
      });
  };
})();
