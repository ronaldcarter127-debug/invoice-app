# Invoice Application

This project is an invoice application that allows users to create, manage, and print invoices and quotes. It is designed to maintain consistent branding and formatting across both the application interface and printed documents.

## Features

- Create and manage invoices and quotes.
- Save invoices and quotes to local storage.
- Print invoices and quotes with consistent branding.
- Responsive design for use on various devices.

## Project Structure

```
invoice-app
├── src
│   ├── index.html          # Main HTML file for the application
│   ├── css
│   │   ├── styles.css      # Main styles for the application
│   │   └── print.css       # Styles for printing invoices and quotes
│   ├── js
│   │   ├── app.js          # Main JavaScript file for application logic
│   │   ├── invoice.js      # Functions for managing invoices
│   │   ├── quote.js        # Functions for managing quotes
│   │   └── storage.js      # Local storage operations
│   └── fonts
│       ├── DancingScript-Regular.woff2  # Decorative script font
│       ├── GreatVibes-Regular.woff2     # Elegant script font
│       ├── Allura-Regular.woff2          # Cursive font
│       └── AlexBrush-Regular.woff2       # Brush script font
├── package.json          # npm configuration file
└── README.md             # Project documentation
```

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```
   cd invoice-app
   ```

3. Install the dependencies:
   ```
   npm install
   ```

4. Open `src/index.html` in your web browser to view the application.

## Usage

- Use the application to create invoices and quotes by filling out the necessary fields.
- Save your invoices and quotes to local storage for future access.
- Print invoices and quotes using the print functionality, which ensures consistent branding and formatting.

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.