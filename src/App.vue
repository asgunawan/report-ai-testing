<script setup lang="ts">
import ChatView from './components/ChatView.vue'
</script>

<template>
  <ChatView />
</template>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#app {
  height: 100%;
  overflow: hidden;
}
</style>
