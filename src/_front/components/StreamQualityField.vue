<template>
    <div class="sp-field">
        <label :for="id">Качество видеотрансляции</label>
        <select :id="id" :value="modelValue || 'hd'" @change="$emit('update:modelValue', $event.target.value)">
            <option value="hd">HD (720p)</option>
            <option value="full_hd" :disabled="!fullHdEnabled">Full HD (1080p)</option>
        </select>
        <p class="sp-note">{{ modelValue === 'full_hd' ? 'Для стабильного интернета, качественных камер и демонстрации мелких деталей.' : 'Для нестабильного интернета и устройств с ограниченной производительностью.' }}</p>
        <p v-if="solo" class="sp-note">Для OBS настройте такое же разрешение в программе. Внешний источник MeetGuru автоматически не перенастраивает.</p>
        <p v-if="!fullHdEnabled" class="sp-note">Full HD будет доступен после проверки серверной мощности и включения администратором.</p>
        <p v-if="live" class="sp-note" role="status">Изменение применится при следующем запуске. Текущий эфир продолжится с прежним качеством.</p>
    </div>
</template>
<script setup>
defineProps({ modelValue: String, id: { type: String, required: true }, live: Boolean, solo: Boolean, fullHdEnabled: Boolean });
defineEmits(['update:modelValue']);
</script>
<style scoped>
.sp-field { display: flex; flex-direction: column; gap: 6px; color: #374151; font-size: 14px; }
label { font-weight: 600; }
select { min-height: 42px; padding: 8px 12px; border: 1px solid #b8c2d3; border-radius: 8px; background: #fff; color: #17233e; }
.sp-note { margin: 0; font-size: 13px; line-height: 1.5; color: #4b5563; }
</style>
