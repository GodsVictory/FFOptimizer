/** Tailwind build config. Rebuild css/tailwind.css with `npm run build:css` after changing classes in index.html or js/. */
module.exports = {
    content: ['./index.html', './js/**/*.js'],
    theme: {
        extend: {
            colors: {
                brand: {
                    50: '#f0fdf4',
                    500: '#10b981',
                    600: '#059669',
                }
            }
        }
    }
};
