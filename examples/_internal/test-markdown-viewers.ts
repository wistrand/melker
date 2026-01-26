// Test script to demonstrate both markdown viewers
// Usage: deno run --allow-read --allow-env examples/test_markdown_viewers.ts

console.log('🧪 Melker Markdown Viewer Test Suite');
console.log('=====================================\n');

const availableFiles = [
  'README.md',
  'sample.md',
  'markdown-plan.md',
  'CLAUDE.md'
];

console.log('Available test files:');
availableFiles.forEach((file, index) => {
  console.log(`  ${index + 1}. ${file}`);
});

console.log('\nTo test the viewers, run:');
console.log('\n📖 Basic Viewer:');
console.log('deno run --allow-read --allow-env examples/markdown_file_viewer.ts <filename>');

console.log('\n🎮 Interactive Viewer (with keyboard controls):');
console.log('deno run --allow-read --allow-env examples/markdown_viewer_interactive.ts <filename>');

console.log('\n✨ Template Viewer (clean syntax + auto scroll):');
console.log('deno run --allow-read --allow-env examples/markdown_template_viewer.ts <filename>');

console.log('\n🎨 Theme Examples:');
console.log('MELKER_THEME=fullcolor-dark deno run --allow-read --allow-env examples/markdown_file_viewer.ts README.md');
console.log('MELKER_THEME=bw-std deno run --allow-read --allow-env examples/markdown_file_viewer.ts README.md');

console.log('\n✨ Features Demonstrated:');
console.log('• Full-screen markdown rendering');
console.log('• Scrollable content containers with automatic mouse wheel support');
console.log('• File reading from command line arguments');
console.log('• Rich terminal formatting (headings, bold, italic, code)');
console.log('• Template literal syntax (HTML-like)');
console.log('• Theme integration');
console.log('• Error handling for missing files');
console.log('• Help text and usage instructions');

console.log('\n🚀 Ready to test! Pick a file and viewer type above.');